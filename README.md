# meetsnaply

Scheduling app in the Calendly / Cal.com mould, with recording, transcription,
and an AI recap emailed to every attendee after the call.

Next.js 16 (App Router) · React 19 · Tailwind v4 · Postgres 17 · Prisma 7

---

## Running it

You need Docker (for Postgres) and Node 20+.

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
npx prisma migrate dev
```

```bash
npx prisma db seed
```

```bash
npm run dev
```

The recap pipeline runs in a separate process. In another terminal:

```bash
npm run worker
```

Then:

- **http://localhost:3000/damir** — public booking page for the seeded host
- **http://localhost:3000/dashboard** — host dashboard, log in as
  `damir@meetsnaply.dev` / `meetsnaply`

Postgres is published on **5433**, not 5432, so it won't collide with a local
install. Set a real `AUTH_SECRET` before deploying anywhere
(`openssl rand -base64 32`).

---

## Deploying to Vercel

Four things must be true before booking links work on a real domain.

**1. A hosted Postgres.** The `docker-compose.yml` database is local only and is
not reachable from Vercel. Use the provider's **pooled** connection string —
serverless functions open a connection per invocation and will exhaust a direct
connection limit under any real traffic.

On Supabase that means **Connection Pooling → Transaction mode, port 6543**, not
the direct string on 5432:

```
postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

No `pgbouncer=true` is needed here, despite it being the usual advice for Prisma
behind PgBouncer. That flag existed to stop Prisma's old Rust engine reusing
*named* prepared statements across pooled connections. Prisma 7 talks to Postgres
through `@prisma/adapter-pg`, which only names a statement when you pass a
`statementNameGenerator` — `src/lib/db.ts` doesn't, so every statement is unnamed
and transaction pooling is safe.

Migrations are the exception: `prisma migrate deploy` runs DDL and advisory locks
that want a real session, so point it at the **direct** connection on port 5432
(`DIRECT_DATABASE_URL`) if migrations misbehave against the pooler.

**2. Environment variables**, set in the Vercel project:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Pooled connection string |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | yes | A *different* 32-byte value. Falls back to `AUTH_SECRET`, but then rotating your session key locks out every connected calendar |
| `NEXT_PUBLIC_APP_URL` | only for a custom domain | The deployed origin. Every booking link, meeting URL, OAuth redirect, and email link is built from it. On Vercel you can leave it unset — `appUrl()` falls back to the injected `VERCEL_PROJECT_PRODUCTION_URL`. Set it explicitly the moment you point a real domain at the project |
| `CRON_SECRET` | for emails | Vercel Cron sends it as a bearer token to `/api/jobs/run` |
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional | Redirect URI must be `<NEXT_PUBLIC_APP_URL>/api/calendar/google/callback` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Without these, emails are logged, not sent |
| `DAILY_*`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` | optional | The recap pipeline |

**3. Migrations run on deploy.** The build script is
`prisma generate && prisma migrate deploy && next build`. The `generate` step is
not optional — `src/generated` is gitignored, so without it the build fails on a
missing Prisma client. If you'd rather migrate by hand, switch the project's
build command to `npm run build:app` and run `npm run db:deploy` yourself.

**4. The queue needs a trigger.** `vercel.json` schedules `/api/jobs/run` every
five minutes. Two caveats worth knowing before you rely on it:

- **Vercel Hobby runs cron once a day**, whatever the expression says, and caps
  functions at 60 seconds. Reminders would be up to a day late.
- Recap generation can exceed 60 seconds on its own.

Booking, rescheduling, and cancelling do not depend on the queue at all — only
the emails and the recap pipeline do. For those, run `npm run worker` on any
host that keeps a process alive (Railway, Fly, a small VM) pointed at the same
`DATABASE_URL`; it is the same drain loop without the timeout.

---

## What's built

| Area | State |
| --- | --- |
| Email + password auth, JWT session cookies | Working |
| Public profile page and per-event-type booking pages | Working |
| Timezone-correct slot generation, DST-safe | Working |
| Weekly schedules, multiple windows per day, date overrides | Working |
| Buffers, minimum notice, booking horizon, per-day caps | Working |
| Custom booking questions (9 field types) | Working |
| Booking, reschedule, cancel, host approval flow | Working |
| Double-booking prevention (app + database constraint) | Working |
| Recording consent gate | Working |
| Google Calendar: conflict checking + write-back | Working (needs credentials) |
| OAuth tokens encrypted at rest (AES-256-GCM) | Working |
| Booking confirmation + host notification, with `.ics` invite | Working (needs credentials) |
| Configurable reminder emails | Working (needs credentials) |
| Cancellation and reschedule notices, with calendar updates | Working (needs credentials) |
| Video rooms, recording, transcription, recap, recap email | Working (needs credentials) |
| Background job queue with retry, backoff, dead-letter | Working |
| Audio retention purge | Working |

Nothing lies about being finished: the settings page marks unwired sections
"Not wired up", and the recap panel says so when no pipeline has run.

---

## How the important parts work

### Availability

`src/lib/availability/engine.ts` is pure and takes everything as arguments, so
it is testable without a database. `src/lib/availability/index.ts` is the thin
Prisma layer over it.

The rule that keeps timezone bugs out: **availability is authored in the host's
zone and immediately expanded into absolute UTC instants.** Rules say things
like "Mondays 09:00–17:00 Europe/Berlin"; those are expanded per host-local
calendar date via `@date-fns/tz`, which is what makes DST transitions correct
rather than approximately correct. Only after expansion is anything compared or
subtracted. The invitee's zone never enters the engine — it is purely a
labelling and grouping concern in the UI.

Two subtleties worth not undoing:

- **The slot grid is anchored to the working window, not to the gaps between
  bookings.** Anchoring to gaps re-aligns the whole day around a conflict and
  produces times like 16:15 sitting next to 14:00 and 14:30.
- **`expandWorkingWindows` filters windows to the requested range without
  clipping their bounds**, because clipping would move `window.start` and
  therefore shift every start time on that day.

### Double booking

Three layers, because the first two both lose races:

1. Slot lists are generated per month for display.
2. `verifySlot()` re-checks the single instant inside the booking request.
3. A Postgres exclusion constraint (`Booking_host_no_overlap`, in the init
   migration) makes an overlapping pair physically unrepresentable. The loser of
   a concurrent race gets a constraint violation, which `createBooking`
   translates into "someone booked that slot a moment before you".

Layer 3 currently assumes one attendee group per slot. Adding group events with
multiple seats means relaxing it with a seat discriminator.

### Google Calendar sync

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see `.env.example` for the
Cloud console steps), then connect an account from **Settings → Calendar
integrations**. With them unset the app runs normally and the UI says the
integration isn't configured — it never renders a button that can't work.

There is no `googleapis` dependency. It is four REST calls behind `fetch` in
`src/lib/calendar/google.ts`; the SDK is enormous and brings its own auth
caching that fights Next's request lifecycle.

**Reading.** Conflicts come from Google's `freeBusy` endpoint rather than
`events.list`, because freeBusy expands recurring events, honours events marked
"free", and returns nothing but intervals — no attendee lists or subjects we
have no business reading. External busy blocks carry no meetsnaply buffers: a
buffer is a property of our event types, and we know nothing about the shape of
someone else's meeting.

**Writing.** Only `CONFIRMED` bookings are mirrored out. A `PENDING` request
still holds the slot inside meetsnaply, but filling a host's real calendar with
holds they haven't accepted is wrong. Approving one is what puts it on the
calendar; declining, cancelling, or rescheduling takes it back off. Mirroring
happens *outside* the booking transaction and records failures on
`Booking.externalSyncError` instead of throwing — a Google outage must never
roll back a booking that is already valid.

**The deliberate asymmetry.** The two paths treat an unreachable calendar
differently, and this is the important design decision in the feature:

- The **booking page fails open** — it renders the slots it knows about and
  shows a warning. A stale slot costs the invitee one extra click.
- The **write path fails closed** — `verifySlot` returns
  `calendar-unreachable` and the booking is refused. Writing over a meeting we
  couldn't see costs the host a real conflict they discover when two people
  dial in.

**Token handling.** Access and refresh tokens are sealed with AES-256-GCM
(`src/lib/crypto.ts`) before they touch a column; a database dump doesn't hand
over anybody's calendar. Tokens refresh a minute before expiry. When Google
returns `invalid_grant` or 401/403, the connection is flagged with the reason,
conflict-checking is switched off so it can't silently block every slot, and
settings prompts a reconnect. Disconnecting revokes the grant at Google rather
than just forgetting the token.

Connections are consulted live on each request. That is correct but not free —
a month view costs one `freeBusy` call per connected calendar. The next step is
Google's push notification channels writing busy blocks into a local cache
table, which also removes the fail-open/fail-closed split.

### Booking emails

Confirmation to the invitee and every guest, a notification to the host, and
reminders — all queued, never sent inline. A booking must not fail because an
email provider is having a bad minute, and the invitee shouldn't wait on an SMTP
round trip before seeing their confirmation page.

**Every email renders in its own recipient's timezone.** An invitee in New York
and a host in Berlin read their own local time from the same meeting, which is
the point of tracking a zone per attendee. This is asserted in both directions.

**Reminders are scheduled, not polled.** Offsets are per event type
(`reminderMinutes`, default 24h and 1h), and each becomes one delayed job at
booking time, so the worker never scans the calendar looking for work. Offsets
already in the past are skipped — booking a meeting 30 minutes out must not fire
a "tomorrow" reminder immediately.

Cancelling, declining, or rescheduling deletes the pending reminders, *and* the
handler re-checks booking status at send time. Both are needed: the delete can
lose a race with a worker that has already claimed the job, and telling someone
their cancelled meeting starts in an hour is the worst thing this feature could
do.

A pending request that needs host approval gets a deliberately different email —
"request sent", no `.ics`, because attaching one would put an event in the
invitee's calendar for a meeting that may never be approved. Approval is what
sends the real confirmation, the invite, and the reminders.

Cancelling and rescheduling notify everyone too, and the wording is **actor
aware**: whoever made the change reads "You cancelled this meeting", everyone
else reads "Damir cancelled this meeting". One neutral sentence for both would
either accuse the wrong person or state something the actor already knows.

**A move sends one email, not two.** Rescheduling cancels one booking and
creates another, but a cancellation followed by an unrelated confirmation
describes the same change twice without either referring to the other. The
reschedule notice speaks for both — it shows *was* and *now* — and the superseded
booking suppresses its own cancellation.

### Calendar identity across a reschedule

A booking row and a calendar event are not the same thing, and conflating them is
what makes rescheduling messy for recipients. `Booking.calendarUid` is the event's
identity: a rescheduled booking **inherits** its predecessor's value and bumps
`calendarSequence`, so the `.ics` is an *update* to the entry already in
everyone's calendar. The old time moves; it does not linger as a dead event
beside a new invitation.

The same identity is what lets a cancellation work at all. `METHOD:CANCEL` only
removes an event when the UID matches one the client already holds *and* the
SEQUENCE outranks it — so the cancel is issued at `calendarSequence + 1`, and the
bump is persisted so a later reissue can't reuse a number a client has seen.

### Calendar invites

`src/lib/email/ics.ts` builds RFC 5545 by hand rather than pulling a library —
the format's real constraints are few, and getting them wrong is silent, since
Outlook and Google both discard a malformed VEVENT without telling the sender.
Four things matter, and all four are covered by assertions:

- **CRLF line endings.** A bare `\n` makes strict parsers reject the file.
- **Folding at 75 _octets_, not characters.** Folding on characters corrupts any
  line containing multi-byte UTF-8 — an accented name, an em dash — because the
  split can land mid-codepoint. The folder walks the UTF-8 encoding and only
  breaks on a boundary.
- **Text escaping.** An unescaped comma in a summary silently truncates the
  property in some clients.
- **`METHOD:CANCEL` with a higher `SEQUENCE`** is what actually removes an event
  from someone's calendar; a REQUEST with `STATUS:CANCELLED` does not. Hence
  `Booking.calendarSequence`.

### The recap pipeline

Five stages, each a queued job that enqueues the next:

```
recording.process  → provider says the recording is ready; store the audio ref
transcript.generate → Deepgram, speaker-diarized, segments persisted
recap.generate     → Claude summarises into a validated JSON shape
recap.send         → email every consenting attendee
recording.purge    → delete the audio when retention expires
```

Stages enqueue rather than call each other, so a failure retries in isolation: a
transient email outage re-sends the email without paying for transcription and
summarisation a second time.

Run the worker with `npm run worker`, or `POST /api/jobs/run` on a schedule if
your host can't keep a process alive. Both drain the same queue.

**The queue is Postgres, not Redis.** The pipeline moves a handful of jobs per
meeting, and `FOR UPDATE SKIP LOCKED` gives exactly-once claiming across multiple
workers without a second piece of infrastructure to run, monitor, and pay for.
Retries back off 30s → 2m → 8m → 32m → 2h and then dead-letter. Failures that
can't be fixed by retrying — a missing API key, a malformed payload, a deleted
record — are raised as `PermanentJobError` and skip the retry budget entirely.

**The database is the only clock.** `runAfter` is computed as `NOW() + interval`
inside the INSERT rather than by the application. Letting Prisma fill
`@default(now())` from the app server's clock means a server running even
milliseconds ahead of Postgres writes a `runAfter` in the *database's* future,
and since claiming compares against `NOW()`, every job silently stalls by that
skew. This was a real bug, caught by the verification harness.

**Recap generation** uses `claude-opus-5` through `beta.messages.parse` with a
Zod-derived JSON schema, so the output is validated against a contract rather
than parsed out of prose — these fields go straight into a database row and an
email, where a shape mismatch would surface as a broken recap in somebody's
inbox. The prompt separates decisions from action items from open questions, and
instructs the model to leave a list empty rather than infer: an invented action
item is worse than a short recap, because recipients act on it. Refusals are
handled, and `fallbacks: "default"` routes a declined request to another model
server-side instead of losing the recap.

Transcripts fit in one request in practice. The chunked path exists so an
unusually long recording degrades into a slightly coarser recap — each chunk is
recapped, then the recaps are recapped, carrying decisions and action items
through verbatim — instead of failing outright.

**Everything degrades.** With no provider keys set, the app runs normally:
meetings get a placeholder room, nothing is recorded, and the pipeline stays
idle. Each stage checks its own key and dead-letters with the exact reason, which
the host sees on the booking with a retry button.

### Recording consent

Recording is only offered where we control the room (`MEETSNAPLY_VIDEO`), and
`normaliseRecording()` in `src/lib/event-types/actions.ts` collapses impossible
combinations server-side — transcription without recording, a recap without a
transcript — so the database can't hold a state the pipeline couldn't honour.

Invitees must tick consent before a recorded meeting can be booked, and the
timestamp lands on `Attendee.recordingConsentAt`. That timestamp is also the
gate on delivery: an attendee without it is skipped when the recap goes out,
because consent to being recorded is the basis for sending them the transcript.

Retention is enforced, not just modelled. The purge job is scheduled the moment
a recording is fetched — before transcription, so a failure later in the pipeline
can never leave audio sitting around indefinitely. It deletes the audio at the
provider and clears the reference, keeping the transcript and recap: the audio is
the sensitive artefact, and the row survives as an audit record that a recording
existed and was deleted on schedule. The window is per event type
(`recordingRetentionDays`, default 30).

---

## Design

Tokens are in `src/app/globals.css`, taken from the reference: warm sand paper,
near-black ink, one burnt-orange accent (`#e8552f`) reserved for primary actions
and selected state. Components reference the semantic layer
(`--surface`, `--text-muted`, `--primary`) and never the raw ramp, so the dark
theme is a variable swap rather than a second set of classes.

---

## Next, in order

1. **Deliverability setup.** Every email path now exists, and none of them has
   ever been delivered by a real provider: no SPF/DKIM, no verified sending
   domain, and no `.ics` has been opened by a real Outlook, Google Calendar, or
   Apple Mail — which is exactly where malformed invites fail silently. This is
   the highest-value next step, and it needs credentials rather than code.
2. **Tests.** The availability engine, `src/lib/crypto.ts`, and the queue are
   where correctness lives, and all three are pure enough to test directly. There
   is still no test runner in the project, which is the largest process gap — the
   verification harnesses written during development were throwaway scripts and
   should be real test files. Provider request/response handling wants recorded
   fixtures rather than live calls.
3. **Google Calendar push notifications**, replacing the live `freeBusy` call
   per request with a locally cached busy table. Then **Outlook**, which slots
   into the same `CalendarConnection` model and the same
   `getExternalBusy` / `syncBookingToCalendar` seams.
4. **Speaker identification.** The transcript labels speakers `Speaker 0`/
   `Speaker 1`; the recap prompt maps them to names where the conversation makes
   it obvious, but the transcript itself stays generic. `TranscriptSegment`
   already carries an `attendeeId` for this — voice matching or join-time
   attribution would fill it in.
5. **Google OAuth login.** Auth is deliberately hand-rolled with `jose` and
   `bcryptjs` rather than pulling in a library that doesn't support Next 16 yet;
   adding an OAuth provider means one route handler plus an `Account` table.
6. Rate limiting and bot protection on the public booking endpoint.

---

## Notes

- Prisma 7 removed the Rust query engine, so the connection URL lives in
  `prisma.config.ts` and the runtime client goes through the `@prisma/adapter-pg`
  driver adapter in `src/lib/db.ts`.
- `src/proxy.ts` (Next 16's rename of `middleware.ts`) only gates routing. Every
  dashboard page still calls `requireUser()` — the proxy is not the auth check.
- `src/generated/prisma` is generated. Re-run `npx prisma generate` after schema
  changes.
