import "dotenv/config";
import assert from "node:assert/strict";
import {
  after,
  before,
  describe,
  it,
  type TestContext,
} from "node:test";

import {
  assertDisposable,
  testDatabaseUrl,
} from "../../../scripts/test-database-url";

/**
 * Integration tests for `/api/v1`.
 *
 * These import the real route handlers and call them as functions with a real
 * `Request`, against a real database. No HTTP server is involved — a route
 * handler in Next 16 is an exported async function, and driving it directly
 * exercises everything that matters (validation, authorisation, the services
 * underneath) without a port to bind or a dev server to keep alive.
 *
 * The suite bootstraps its own world through the API itself: signing up seeds
 * a user, a schedule, and two event types, so nothing here depends on the dev
 * seed data or on the order tests happen to run in.
 *
 * Like the queue's tests, this needs the disposable `*_test` database and
 * skips cleanly without one:
 *
 *     npm run test:db:setup
 */

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;

let unavailable: string | null = null;
let db: typeof import("@/lib/db").db;
let routes: Record<string, Record<string, Handler>>;

/** Session token for the host this suite creates. */
let token = "";
let host: { username: string; email: string };

const PASSWORD = "correct horse battery staple";

function url(path: string) {
  return `http://localhost/api/v1${path}`;
}

/** Calls a handler the way Next would, with auth unless told otherwise. */
async function call(
  key: string,
  method: string,
  path: string,
  options: {
    body?: unknown;
    params?: Record<string, string>;
    auth?: string | null;
  } = {},
) {
  const handler = routes[key]?.[method];
  assert.ok(handler, `no ${method} handler registered for ${key}`);

  const bearer = options.auth === undefined ? token : options.auth;
  const headers = new Headers();
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const { NextRequest } = await import("next/server");
  const request = new NextRequest(url(path), {
    method,
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });

  const response = await handler(request, {
    params: Promise.resolve(options.params ?? {}),
  });

  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

before(async () => {
  const target = testDatabaseUrl();
  if (!target) {
    unavailable = "DATABASE_URL is not set";
    return;
  }
  try {
    assertDisposable(target);
  } catch (error) {
    unavailable = (error as Error).message;
    return;
  }

  // Must precede the first import of @/lib/db, which builds its client from
  // whatever DATABASE_URL held at module scope.
  process.env.DATABASE_URL = target;
  // The services seal OAuth tokens; without a key, importing them throws.
  process.env.ENCRYPTION_KEY ??= "endpoint-tests-encryption-key-0123456789";
  process.env.AUTH_SECRET ??= "endpoint-tests-auth-secret-0123456789abcd";

  try {
    db = (await import("@/lib/db")).db;
    await db.$queryRaw`SELECT 1 FROM "User" LIMIT 0`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const summary =
      message
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? "cannot reach the database";
    unavailable = `${summary} — run \`npm run test:db:setup\``;
    return;
  }

  routes = {
    signup: await import("@/app/api/v1/auth/signup/route"),
    login: await import("@/app/api/v1/auth/login/route"),
    me: await import("@/app/api/v1/auth/me/route"),
    dashboard: await import("@/app/api/v1/dashboard/route"),
    bookings: await import("@/app/api/v1/bookings/route"),
    booking: await import("@/app/api/v1/bookings/[uid]/route"),
    bookingStatus: await import("@/app/api/v1/bookings/[uid]/status/route"),
    eventTypes: await import("@/app/api/v1/event-types/route"),
    eventType: await import("@/app/api/v1/event-types/[id]/route"),
    schedule: await import("@/app/api/v1/schedule/route"),
    overrides: await import("@/app/api/v1/schedule/overrides/route"),
    override: await import("@/app/api/v1/schedule/overrides/[id]/route"),
    settings: await import("@/app/api/v1/settings/route"),
    publicHost: await import("@/app/api/v1/public/hosts/[username]/route"),
    publicEventType: await import(
      "@/app/api/v1/public/hosts/[username]/[slug]/route"
    ),
    publicBookings: await import("@/app/api/v1/public/bookings/route"),
    publicBooking: await import("@/app/api/v1/public/bookings/[uid]/route"),
    publicCancel: await import(
      "@/app/api/v1/public/bookings/[uid]/cancel/route"
    ),
  } as unknown as typeof routes;

  // A unique host per run, so repeated runs never collide on the email or the
  // handle, and so no test can depend on another's leftovers.
  const stamp = Date.now().toString(36);
  host = { username: "", email: `host-${stamp}@example.test` };

  const signedUp = await call("signup", "POST", "/auth/signup", {
    auth: null,
    body: {
      name: `Test Host ${stamp}`,
      email: host.email,
      password: PASSWORD,
      timeZone: "Europe/Berlin",
    },
  });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  token = signedUp.body.token;
  host.username = signedUp.body.user.username;
});

after(async () => {
  if (db) await db.$disconnect();
});

/** Skips instead of failing when there is no database to talk to. */
function apiIt(name: string, fn: () => Promise<void>) {
  it(name, async (t: TestContext) => {
    if (unavailable) {
      t.skip(`no test database: ${unavailable}`);
      return;
    }
    await fn();
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("auth", () => {
  apiIt("signing up seeds a schedule and starter event types", async () => {
    const { status, body } = await call("eventTypes", "GET", "/event-types");
    assert.equal(status, 200);
    assert.deepEqual(
      body.eventTypes.map((e: { slug: string }) => e.slug).sort(),
      ["deep-dive", "intro-call"],
    );

    const schedule = await call("schedule", "GET", "/schedule");
    assert.equal(schedule.body.schedules.length, 1);
    // Weekdays, nine to five.
    assert.equal(schedule.body.schedules[0].rules.length, 5);
  });

  apiIt("exchanges credentials for a usable token", async () => {
    const { status, body } = await call("login", "POST", "/auth/login", {
      auth: null,
      body: { email: host.email, password: PASSWORD },
    });
    assert.equal(status, 200);
    assert.equal(body.user.email, host.email);

    const me = await call("me", "GET", "/auth/me", { auth: body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.username, host.username);
  });

  apiIt("refuses a wrong password without saying which field failed", async () => {
    const { status, body } = await call("login", "POST", "/auth/login", {
      auth: null,
      body: { email: host.email, password: "not the password" },
    });
    assert.equal(status, 401);
    assert.equal(body.error.code, "unauthorized");
    assert.ok(!body.error.fieldErrors);
  });

  apiIt("reports per-field problems on a malformed sign-in", async () => {
    const { status, body } = await call("login", "POST", "/auth/login", {
      auth: null,
      body: { email: "not-an-email", password: "" },
    });
    assert.equal(status, 422);
    assert.equal(body.error.fieldErrors.email, "Enter a valid email");
    assert.equal(body.error.fieldErrors.password, "Enter your password");
  });

  apiIt("will not register the same email twice", async () => {
    const { status, body } = await call("signup", "POST", "/auth/signup", {
      auth: null,
      body: {
        name: "Impostor",
        email: host.email,
        password: PASSWORD,
        timeZone: "UTC",
      },
    });
    assert.equal(status, 422);
    assert.match(body.error.fieldErrors.email, /already registered/);
  });

  apiIt("rejects every authenticated route without a good token", async () => {
    for (const auth of [null, "not.a.jwt"]) {
      for (const [key, path] of [
        ["dashboard", "/dashboard"],
        ["bookings", "/bookings"],
        ["eventTypes", "/event-types"],
        ["schedule", "/schedule"],
        ["settings", "/settings"],
      ] as const) {
        const { status } = await call(key, "GET", path, { auth });
        assert.equal(status, 401, `${path} with auth=${auth}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Booking, the whole way through
// ---------------------------------------------------------------------------

describe("booking", () => {
  /** A free slot for the seeded intro-call event type. */
  async function firstSlot(index = 0) {
    const { status, body } = await call(
      "publicEventType",
      "GET",
      `/public/hosts/${host.username}/intro-call`,
      { auth: null, params: { username: host.username, slug: "intro-call" } },
    );
    assert.equal(status, 200);
    assert.ok(body.slots.length > index, "no slots to book");
    return body.slots[index] as string;
  }

  function bookingBody(start: string, extra: Record<string, unknown> = {}) {
    return {
      username: host.username,
      slug: "intro-call",
      start,
      timeZone: "Europe/Berlin",
      name: "An Invitee",
      email: "invitee@example.test",
      ...extra,
    };
  }

  apiIt("lists a host's public event types", async () => {
    const { status, body } = await call(
      "publicHost",
      "GET",
      `/public/hosts/${host.username}`,
      { auth: null, params: { username: host.username } },
    );
    assert.equal(status, 200);
    assert.equal(body.host.username, host.username);
    assert.ok(body.host.eventTypes.length >= 1);
  });

  apiIt("404s an unknown host and an unknown event type", async () => {
    const host404 = await call("publicHost", "GET", "/public/hosts/nobody", {
      auth: null,
      params: { username: "nobody" },
    });
    assert.equal(host404.status, 404);

    const slug404 = await call(
      "publicEventType",
      "GET",
      `/public/hosts/${host.username}/nope`,
      { auth: null, params: { username: host.username, slug: "nope" } },
    );
    assert.equal(slug404.status, 404);
  });

  apiIt("books a slot, and the host can see it", async () => {
    const start = await firstSlot(0);
    const created = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(start, { guests: ["guest@example.test"] }),
    });

    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { uid, attendees, status } = created.body.booking;
    assert.equal(status, "CONFIRMED");
    // The invitee plus the guest; the host is not an attendee row.
    assert.equal(attendees.length, 2);

    const hostView = await call("booking", "GET", `/bookings/${uid}`, {
      params: { uid },
    });
    assert.equal(hostView.status, 200);
    assert.equal(hostView.body.booking.uid, uid);

    const list = await call("bookings", "GET", "/bookings?tab=upcoming");
    assert.ok(
      list.body.bookings.some((b: { uid: string }) => b.uid === uid),
      "booking missing from the upcoming tab",
    );
  });

  apiIt("refuses to book the same slot twice", async () => {
    const start = await firstSlot(1);
    const first = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(start),
    });
    assert.equal(first.status, 201);

    const second = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(start),
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, "conflict");
  });

  apiIt("refuses a slot that is not on the grid", async () => {
    const start = await firstSlot(2);
    // Seven minutes past a real slot: inside the working window, off the grid.
    const offGrid = new Date(
      new Date(start).getTime() + 7 * 60_000,
    ).toISOString();

    const { status } = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(offGrid),
    });
    assert.equal(status, 409);
  });

  apiIt("rejects a booking with no name or a bad address", async () => {
    const start = await firstSlot(3);
    const { status, body } = await call(
      "publicBookings",
      "POST",
      "/public/bookings",
      { auth: null, body: bookingBody(start, { name: "", email: "nope" }) },
    );
    assert.equal(status, 422);
    assert.equal(body.error.fieldErrors.name, "Enter your name");
    assert.equal(body.error.fieldErrors.email, "Enter a valid email");
  });

  apiIt("cancels once, and refuses to cancel again", async () => {
    const start = await firstSlot(4);
    const created = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(start),
    });
    const uid = created.body.booking.uid;

    const cancelled = await call(
      "publicCancel",
      "POST",
      `/public/bookings/${uid}/cancel`,
      { auth: null, params: { uid }, body: { reason: "changed my mind" } },
    );
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.booking.status, "CANCELLED");

    const again = await call(
      "publicCancel",
      "POST",
      `/public/bookings/${uid}/cancel`,
      { auth: null, params: { uid }, body: {} },
    );
    assert.equal(again.status, 404);
  });

  apiIt("lets the host cancel, and 404s an unknown uid", async () => {
    const start = await firstSlot(5);
    const created = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: bookingBody(start),
    });
    const uid = created.body.booking.uid;

    const changed = await call(
      "bookingStatus",
      "POST",
      `/bookings/${uid}/status`,
      { params: { uid }, body: { status: "CANCELLED" } },
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.body.booking.status, "CANCELLED");

    const missing = await call("bookingStatus", "POST", "/bookings/x/status", {
      params: { uid: "x" },
      body: { status: "CANCELLED" },
    });
    assert.equal(missing.status, 404);
  });

  apiIt("requires consent before booking a recorded meeting", async () => {
    // deep-dive is seeded with recording and transcription on.
    const listing = await call(
      "publicEventType",
      "GET",
      `/public/hosts/${host.username}/deep-dive`,
      { auth: null, params: { username: host.username, slug: "deep-dive" } },
    );
    assert.equal(listing.status, 200);
    assert.equal(listing.body.eventType.transcriptionEnabled, true);

    const start = listing.body.slots[0];
    const body = {
      username: host.username,
      slug: "deep-dive",
      start,
      timeZone: "Europe/Berlin",
      name: "An Invitee",
      email: "invitee@example.test",
    };

    const refused = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body,
    });
    assert.equal(refused.status, 422);
    assert.match(
      refused.body.error.fieldErrors.consentRecording,
      /recorded and transcribed/,
    );

    const accepted = await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: { ...body, consentRecording: true },
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  });
});

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

describe("event types", () => {
  const base = {
    title: "API Created",
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 0,
    bookingHorizonDays: 60,
    locationType: "MEETSNAPLY_VIDEO",
    isActive: true,
  };

  apiIt("creates, reads back, updates, and deletes", async () => {
    const created = await call("eventTypes", "POST", "/event-types", {
      body: base,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.eventType.id;
    assert.equal(created.body.eventType.slug, "api-created");

    const read = await call("eventType", "GET", `/event-types/${id}`, {
      params: { id },
    });
    assert.equal(read.status, 200);

    const updated = await call("eventType", "PATCH", `/event-types/${id}`, {
      params: { id },
      body: { ...base, title: "API Renamed", durationMinutes: 45 },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.eventType.title, "API Renamed");
    assert.equal(updated.body.eventType.durationMinutes, 45);

    const deleted = await call("eventType", "DELETE", `/event-types/${id}`, {
      params: { id },
    });
    assert.equal(deleted.status, 200);
    // Nothing booked against it, so it is really gone rather than archived.
    assert.equal(deleted.body.archived, false);

    const gone = await call("eventType", "GET", `/event-types/${id}`, {
      params: { id },
    });
    assert.equal(gone.status, 404);
  });

  apiIt("accepts its own representation back unchanged", async () => {
    // The regression that motivated this: nullable columns come back as null,
    // and a client doing read-modify-write sends null straight back. Declaring
    // them optional made the API reject its own output.
    const created = await call("eventTypes", "POST", "/event-types", {
      body: { ...base, title: "Round Trip" },
    });
    const eventType = created.body.eventType;
    assert.equal(eventType.description, null);
    assert.equal(eventType.locationValue, null);

    const echoed = await call(
      "eventType",
      "PATCH",
      `/event-types/${eventType.id}`,
      { params: { id: eventType.id }, body: eventType },
    );
    assert.equal(echoed.status, 200, JSON.stringify(echoed.body));
  });

  apiIt("archives rather than deletes once something is booked", async () => {
    const listing = await call(
      "publicEventType",
      "GET",
      `/public/hosts/${host.username}/intro-call`,
      { auth: null, params: { username: host.username, slug: "intro-call" } },
    );
    const start = listing.body.slots[10];

    await call("publicBookings", "POST", "/public/bookings", {
      auth: null,
      body: {
        username: host.username,
        slug: "intro-call",
        start,
        timeZone: "Europe/Berlin",
        name: "Booked It",
        email: "booked@example.test",
      },
    });

    const all = await call("eventTypes", "GET", "/event-types");
    const intro = all.body.eventTypes.find(
      (e: { slug: string }) => e.slug === "intro-call",
    );

    const deleted = await call("eventType", "DELETE", `/event-types/${intro.id}`, {
      params: { id: intro.id },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.archived, true);

    // Still there, but retired.
    const after = await call("eventType", "GET", `/event-types/${intro.id}`, {
      params: { id: intro.id },
    });
    assert.equal(after.status, 200);
    assert.equal(after.body.eventType.isActive, false);
    assert.equal(after.body.eventType.isPrivate, true);
  });

  apiIt("rejects an event type with no title", async () => {
    const { status, body } = await call("eventTypes", "POST", "/event-types", {
      body: { ...base, title: "" },
    });
    assert.equal(status, 422);
    assert.equal(body.error.fieldErrors.title, "Give it a name");
  });

  apiIt("requires an address for an in-person meeting", async () => {
    const { status, body } = await call("eventTypes", "POST", "/event-types", {
      body: { ...base, title: "In Person", locationType: "IN_PERSON" },
    });
    assert.equal(status, 422);
    assert.equal(body.error.fieldErrors.locationValue, "Add the address");
  });

  apiIt("will not record where it does not control the room", async () => {
    const { body } = await call("eventTypes", "POST", "/event-types", {
      body: {
        ...base,
        title: "Phone Call",
        locationType: "PHONE_HOST_CALLS",
        recordingEnabled: true,
        transcriptionEnabled: true,
        sendRecapToAttendees: true,
      },
    });
    // Normalised down: no room we own means no recording, so no transcript,
    // so no recap.
    assert.equal(body.eventType.recordingEnabled, false);
    assert.equal(body.eventType.transcriptionEnabled, false);
    assert.equal(body.eventType.sendRecapToAttendees, false);
  });
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

describe("schedule", () => {
  async function currentSchedule() {
    const { body } = await call("schedule", "GET", "/schedule");
    return body.schedules[0];
  }

  apiIt("round-trips the week unchanged", async () => {
    const before = await currentSchedule();
    const rules = before.rules.map(
      (r: { weekday: number; startMinute: number; endMinute: number }) => ({
        weekday: r.weekday,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
      }),
    );

    const { status, body } = await call("schedule", "PUT", "/schedule", {
      body: { scheduleId: before.id, timeZone: before.timeZone, rules },
    });
    assert.equal(status, 200);
    assert.deepEqual(
      body.schedules[0].rules.map(
        (r: { weekday: number; startMinute: number }) => [
          r.weekday,
          r.startMinute,
        ],
      ),
      rules.map((r: { weekday: number; startMinute: number }) => [
        r.weekday,
        r.startMinute,
      ]),
    );
  });

  apiIt("accepts an empty week, which clears every window", async () => {
    const schedule = await currentSchedule();
    const cleared = await call("schedule", "PUT", "/schedule", {
      body: { scheduleId: schedule.id, timeZone: schedule.timeZone, rules: [] },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.schedules[0].rules.length, 0);

    // Put the week back for anything that runs after this.
    await call("schedule", "PUT", "/schedule", {
      body: {
        scheduleId: schedule.id,
        timeZone: schedule.timeZone,
        rules: [1, 2, 3, 4, 5].map((weekday) => ({
          weekday,
          startMinute: 9 * 60,
          endMinute: 17 * 60,
        })),
      },
    });
  });

  apiIt("rejects overlapping windows on the same day", async () => {
    const schedule = await currentSchedule();
    const { status, body } = await call("schedule", "PUT", "/schedule", {
      body: {
        scheduleId: schedule.id,
        rules: [
          { weekday: 1, startMinute: 540, endMinute: 720 },
          { weekday: 1, startMinute: 600, endMinute: 780 },
        ],
      },
    });
    assert.equal(status, 422);
    assert.match(body.error.message, /Monday has overlapping windows/);
  });

  apiIt("rejects a window that ends before it starts", async () => {
    const schedule = await currentSchedule();
    const { status, body } = await call("schedule", "PUT", "/schedule", {
      body: {
        scheduleId: schedule.id,
        rules: [{ weekday: 3, startMinute: 900, endMinute: 540 }],
      },
    });
    assert.equal(status, 422);
    assert.match(body.error.message, /end time must be after the start time/);
  });

  apiIt("will not touch someone else's schedule", async () => {
    const { status } = await call("schedule", "PUT", "/schedule", {
      body: { scheduleId: "not-mine", rules: [] },
    });
    assert.equal(status, 404);
  });

  apiIt("adds and removes a date override", async () => {
    const schedule = await currentSchedule();
    const added = await call("overrides", "POST", "/schedule/overrides", {
      body: { scheduleId: schedule.id, date: "2026-12-24", blocked: true },
    });
    assert.equal(added.status, 200);
    assert.equal(added.body.overrides.length, 1);
    assert.equal(added.body.overrides[0].isBlocked, true);

    const id = added.body.overrides[0].id;
    const removed = await call("override", "DELETE", `/schedule/overrides/${id}`, {
      params: { id },
    });
    assert.equal(removed.status, 200);

    const again = await call("override", "DELETE", `/schedule/overrides/${id}`, {
      params: { id },
    });
    assert.equal(again.status, 404);
  });

  apiIt("treats an override with no usable hours as a block", async () => {
    const schedule = await currentSchedule();
    const { body } = await call("overrides", "POST", "/schedule/overrides", {
      body: {
        scheduleId: schedule.id,
        date: "2026-12-25",
        blocked: false,
        startMinute: 900,
        endMinute: 540, // ends before it starts
      },
    });
    const christmas = body.overrides.find((o: { date: string }) =>
      o.date.startsWith("2026-12-25"),
    );
    assert.equal(christmas.isBlocked, true);
    assert.equal(christmas.startMinute, null);
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("settings", () => {
  apiIt("saves the profile without reissuing a token", async () => {
    const me = (await call("settings", "GET", "/settings")).body.user;
    const { status, body } = await call("settings", "PATCH", "/settings", {
      body: {
        name: "Renamed Host",
        username: me.username,
        bio: "Now with a bio",
        timeZone: me.timeZone,
      },
    });
    assert.equal(status, 200);
    assert.equal(body.user.name, "Renamed Host");
    assert.equal(body.user.bio, "Now with a bio");
    // The handle did not move, so the token's claims are still accurate.
    assert.equal(body.token, undefined);
  });

  apiIt("reissues the token when the handle changes", async () => {
    const me = (await call("settings", "GET", "/settings")).body.user;
    const moved = `${me.username}-moved`;

    const { status, body } = await call("settings", "PATCH", "/settings", {
      body: { name: me.name, username: moved, timeZone: me.timeZone },
    });
    assert.equal(status, 200);
    assert.equal(body.user.username, moved);
    assert.ok(body.token, "expected a fresh token");
    assert.notEqual(body.token, token);

    // The new token works, and so does the old one: routes resolve the user by
    // id, so the stale handle claim never gates access.
    const withNew = await call("me", "GET", "/auth/me", { auth: body.token });
    assert.equal(withNew.body.username, moved);
    const withOld = await call("me", "GET", "/auth/me");
    assert.equal(withOld.status, 200);

    token = body.token;
    host.username = moved;
  });

  apiIt("refuses a handle that is already taken", async () => {
    const stamp = Date.now().toString(36);
    const other = await call("signup", "POST", "/auth/signup", {
      auth: null,
      body: {
        name: "Someone Else",
        email: `other-${stamp}@example.test`,
        password: PASSWORD,
        timeZone: "UTC",
      },
    });
    assert.equal(other.status, 201);

    const me = (await call("settings", "GET", "/settings")).body.user;
    const { status, body } = await call("settings", "PATCH", "/settings", {
      body: {
        name: me.name,
        username: other.body.user.username,
        timeZone: me.timeZone,
      },
    });
    assert.equal(status, 422);
    assert.equal(body.error.fieldErrors.username, "That handle is taken");
  });

  apiIt("rejects a handle with illegal characters", async () => {
    const me = (await call("settings", "GET", "/settings")).body.user;
    const { status, body } = await call("settings", "PATCH", "/settings", {
      body: { name: me.name, username: "Not A Handle!", timeZone: me.timeZone },
    });
    assert.equal(status, 422);
    assert.ok(body.error.fieldErrors.username);
  });
});
