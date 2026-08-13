import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it, type TestContext } from "node:test";

import {
  assertDisposable,
  testDatabaseUrl,
} from "../../../scripts/test-database-url";

/**
 * Integration tests for the Postgres-backed work queue.
 *
 * The queue's correctness lives in its SQL — `FOR UPDATE SKIP LOCKED` is what
 * makes multiple workers safe, `ON CONFLICT` is what makes deduplication
 * atomic, and `NOW()` is what keeps the database the only clock. None of that
 * survives being mocked, so these run against a real database.
 *
 * They connect to a dedicated `*_test` database (see scripts/test-database-url)
 * and truncate the Job table between tests. When that database is missing the
 * whole suite skips rather than failing, so `npm test` still works on a machine
 * with no Postgres:
 *
 *     npm run test:db:setup
 */

type QueueModule = typeof import("./queue");
type DbModule = typeof import("@/lib/db");

let queue: QueueModule;
let db: DbModule["db"];
let unavailable: string | null = null;

before(async () => {
  const url = testDatabaseUrl();
  if (!url) {
    unavailable = "DATABASE_URL is not set";
    return;
  }

  try {
    assertDisposable(url);
  } catch (error) {
    unavailable = (error as Error).message;
    return;
  }

  // Must be set before @/lib/db is imported: it builds its client at module
  // scope from whatever DATABASE_URL held at that moment.
  process.env.DATABASE_URL = url;

  try {
    const dbModule = (await import("@/lib/db")) as DbModule;
    db = dbModule.db;
    // Cheapest proof that the database exists *and* has been migrated.
    await db.$queryRaw`SELECT 1 FROM "Job" LIMIT 0`;
    queue = (await import("./queue")) as QueueModule;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Prisma's connection errors open with blank lines.
    const summary =
      message
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? "cannot reach the database";
    unavailable = `${summary} — run \`npm run test:db:setup\``;
  }
});

after(async () => {
  // `db` is assigned before the reachability probe runs, so it can exist even
  // when the database does not — only the disconnect is safe unconditionally.
  if (!db) return;
  if (!unavailable) await db.$executeRaw`TRUNCATE TABLE "Job"`;
  await db.$disconnect();
});

beforeEach(async () => {
  if (!unavailable) await db.$executeRaw`TRUNCATE TABLE "Job"`;
});

/** Skips instead of failing when there is no database to talk to. */
function dbIt(name: string, fn: () => Promise<void>) {
  it(name, async (t: TestContext) => {
    if (unavailable) {
      t.skip(`no test database: ${unavailable}`);
      return;
    }
    await fn();
  });
}

/** The row as the database actually holds it. */
async function readJob(id: string) {
  return db.job.findUniqueOrThrow({ where: { id } });
}

async function dbNow(): Promise<Date> {
  const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT NOW() as now`;
  return now;
}

/** Backdates a job's lock so the stale-lock reclaim path can be exercised. */
async function backdateLock(id: string, ageMs: number) {
  await db.$executeRaw`
    UPDATE "Job"
    SET "lockedAt" = NOW() - make_interval(secs => ${ageMs / 1000})
    WHERE id = ${id};
  `;
}

const MINUTE = 60_000;

// ---------------------------------------------------------------------------
// enqueue
// ---------------------------------------------------------------------------

describe("enqueue", () => {
  dbIt("inserts a pending job with its payload", async () => {
    const job = await queue.enqueue({
      type: "booking.confirmation",
      payload: { bookingId: "abc" },
    });

    const stored = await readJob(job.id);
    assert.equal(stored.type, "booking.confirmation");
    assert.equal(stored.status, "PENDING");
    assert.deepEqual(stored.payload, { bookingId: "abc" });
    assert.equal(stored.attempts, 0);
    assert.equal(stored.maxAttempts, 5);
    assert.equal(stored.lockedAt, null);
    assert.equal(stored.lastError, null);
  });

  dbIt("defaults the payload to an empty object", async () => {
    const job = await queue.enqueue({ type: "recording.purge" });
    assert.deepEqual((await readJob(job.id)).payload, {});
  });

  dbIt("honours an explicit maxAttempts", async () => {
    const job = await queue.enqueue({ type: "recap.generate", maxAttempts: 2 });
    assert.equal((await readJob(job.id)).maxAttempts, 2);
  });

  dbIt("schedules against the database clock, not the caller's", async () => {
    const job = await queue.enqueue({
      type: "booking.reminder",
      delayMs: 30 * MINUTE,
    });

    const stored = await readJob(job.id);
    const now = await dbNow();
    const delay = stored.runAfter.getTime() - now.getTime();

    // Within a minute of half an hour out, measured entirely in database time:
    // a skewed application clock must not move this.
    assert.ok(
      Math.abs(delay - 30 * MINUTE) < MINUTE,
      `runAfter was ${delay}ms out, expected ~${30 * MINUTE}ms`,
    );
  });

  dbIt("makes an undelayed job immediately runnable", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    const stored = await readJob(job.id);
    assert.ok(stored.runAfter.getTime() <= (await dbNow()).getTime());
  });

  dbIt("collapses duplicate enqueues onto one row", async () => {
    const first = await queue.enqueue({
      type: "recap.send",
      dedupeKey: "recap:booking-1",
      payload: { attempt: "first" },
    });
    const second = await queue.enqueue({
      type: "recap.send",
      dedupeKey: "recap:booking-1",
      payload: { attempt: "second" },
    });

    assert.equal(second.id, first.id);
    assert.equal(await db.job.count(), 1);
    // The first write wins; the duplicate is discarded, not merged.
    assert.deepEqual((await readJob(first.id)).payload, { attempt: "first" });
  });

  dbIt("never collapses jobs that have no dedupe key", async () => {
    const first = await queue.enqueue({ type: "recording.purge" });
    const second = await queue.enqueue({ type: "recording.purge" });

    assert.notEqual(second.id, first.id);
    assert.equal(await db.job.count(), 2);
  });

  dbIt("keeps deduping against a job that has already finished", async () => {
    // Worth pinning: the unique index does not care about status, so a
    // completed job still blocks re-enqueue under the same key. Anything meant
    // to recur has to vary its key.
    const first = await queue.enqueue({
      type: "recap.send",
      dedupeKey: "recap:booking-2",
    });
    await queue.completeJob(first.id);

    const second = await queue.enqueue({
      type: "recap.send",
      dedupeKey: "recap:booking-2",
    });

    assert.equal(second.id, first.id);
    assert.equal(second.status, "DONE");
    assert.equal(await db.job.count(), 1);
  });
});

// ---------------------------------------------------------------------------
// claimJob
// ---------------------------------------------------------------------------

describe("claimJob", () => {
  dbIt("returns null on an empty queue", async () => {
    assert.equal(await queue.claimJob("worker-1"), null);
  });

  dbIt("claims a runnable job and marks it running", async () => {
    const job = await queue.enqueue({
      type: "booking.confirmation",
      payload: { bookingId: "abc" },
    });

    const claimed = await queue.claimJob("worker-1");
    assert.equal(claimed?.id, job.id);
    assert.equal(claimed?.type, "booking.confirmation");
    assert.deepEqual(claimed?.payload, { bookingId: "abc" });
    assert.equal(claimed?.attempts, 1);

    const stored = await readJob(job.id);
    assert.equal(stored.status, "RUNNING");
    assert.equal(stored.lockedBy, "worker-1");
    assert.ok(stored.lockedAt);
    assert.ok(stored.startedAt);
  });

  dbIt("leaves a job scheduled for the future alone", async () => {
    await queue.enqueue({ type: "booking.reminder", delayMs: 60 * MINUTE });
    assert.equal(await queue.claimJob("worker-1"), null);
  });

  dbIt("claims in runAfter order", async () => {
    const later = await queue.enqueue({ type: "recap.send" });
    // Backdate one job so its schedule is unambiguously older.
    const earlier = await queue.enqueue({ type: "recap.generate" });
    await db.$executeRaw`
      UPDATE "Job" SET "runAfter" = NOW() - interval '1 hour' WHERE id = ${earlier.id};
    `;

    assert.equal((await queue.claimJob("worker-1"))?.id, earlier.id);
    assert.equal((await queue.claimJob("worker-1"))?.id, later.id);
    assert.equal(await queue.claimJob("worker-1"), null);
  });

  dbIt("ignores jobs that are done or failed", async () => {
    const done = await queue.enqueue({ type: "recap.send" });
    await queue.completeJob(done.id);

    const failed = await queue.enqueue({ type: "recap.generate" });
    const claimed = await queue.claimJob("worker-1");
    await queue.failJob({ ...claimed!, maxAttempts: 1 }, new Error("nope"));
    assert.equal((await readJob(failed.id)).status, "FAILED");

    assert.equal(await queue.claimJob("worker-2"), null);
  });

  dbIt("does not reclaim a job whose worker still holds the lock", async () => {
    await queue.enqueue({ type: "recap.send" });
    assert.ok(await queue.claimJob("worker-1"));
    assert.equal(await queue.claimJob("worker-2"), null);
  });

  dbIt("reclaims a job whose worker died mid-run", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    await queue.claimJob("worker-1");
    // The lock times out after ten minutes.
    await backdateLock(job.id, 11 * MINUTE);

    const reclaimed = await queue.claimJob("worker-2");
    assert.equal(reclaimed?.id, job.id);
    // The attempt counter carries across, so a job that keeps killing its
    // worker still exhausts its budget instead of looping forever.
    assert.equal(reclaimed?.attempts, 2);
    assert.equal((await readJob(job.id)).lockedBy, "worker-2");
  });

  dbIt("does not reclaim a lock that is merely old-ish", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    await queue.claimJob("worker-1");
    await backdateLock(job.id, 9 * MINUTE);

    assert.equal(await queue.claimJob("worker-2"), null);
  });

  dbIt("preserves startedAt across a reclaim", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    await queue.claimJob("worker-1");
    const firstStart = (await readJob(job.id)).startedAt;

    await backdateLock(job.id, 11 * MINUTE);
    await queue.claimJob("worker-2");

    assert.deepEqual((await readJob(job.id)).startedAt, firstStart);
  });

  dbIt("hands the same job to only one of several racing workers", async () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      ids.add((await queue.enqueue({ type: "recording.purge" })).id);
    }

    // Five workers claiming at once: SKIP LOCKED must give each a distinct row
    // rather than letting two of them run the same job.
    const claimed = await Promise.all(
      Array.from({ length: 5 }, (_, i) => queue.claimJob(`worker-${i}`)),
    );

    const claimedIds = claimed.map((job) => job?.id).filter(Boolean) as string[];
    assert.equal(new Set(claimedIds).size, claimedIds.length, "duplicate claim");
    assert.ok(claimedIds.length > 0);
    for (const id of claimedIds) assert.ok(ids.has(id));

    // Draining the rest must never re-issue anything already claimed: across
    // both rounds every worker holds a distinct job.
    const second = await Promise.all(
      Array.from({ length: 5 }, () => queue.claimJob("late-worker")),
    );
    const everything = [
      ...claimedIds,
      ...(second.map((job) => job?.id).filter(Boolean) as string[]),
    ];
    assert.equal(
      new Set(everything).size,
      everything.length,
      "a job was claimed twice",
    );
    assert.ok(everything.length <= 5);
  });
});

// ---------------------------------------------------------------------------
// completeJob
// ---------------------------------------------------------------------------

describe("completeJob", () => {
  dbIt("marks the job done and releases the lock", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    await queue.claimJob("worker-1");
    await queue.completeJob(job.id);

    const stored = await readJob(job.id);
    assert.equal(stored.status, "DONE");
    assert.ok(stored.completedAt);
    assert.equal(stored.lockedAt, null);
    assert.equal(stored.lockedBy, null);
    assert.equal(stored.lastError, null);
  });

  dbIt("clears the error left by an earlier failed attempt", async () => {
    const job = await queue.enqueue({ type: "recap.send" });
    const claimed = await queue.claimJob("worker-1");
    await queue.failJob(claimed!, new Error("transient"));
    assert.ok((await readJob(job.id)).lastError);

    await queue.completeJob(job.id);
    assert.equal((await readJob(job.id)).lastError, null);
  });
});

// ---------------------------------------------------------------------------
// failJob
// ---------------------------------------------------------------------------

describe("failJob", () => {
  /** Enqueues and claims one job, returning it as the runner would see it. */
  async function claimed(maxAttempts = 5) {
    await queue.enqueue({ type: "recap.generate", maxAttempts });
    return (await queue.claimJob("worker-1"))!;
  }

  dbIt("schedules a retry and records the error", async () => {
    const job = await claimed();
    const result = await queue.failJob(job, new Error("provider timed out"));

    assert.equal(result.willRetry, true);

    const stored = await readJob(job.id);
    assert.equal(stored.status, "PENDING");
    assert.equal(stored.lastError, "provider timed out");
    assert.equal(stored.lockedAt, null);
    assert.equal(stored.lockedBy, null);
    // Held back until the backoff elapses.
    assert.ok(stored.runAfter.getTime() > (await dbNow()).getTime());
  });

  dbIt("schedules the retry on the database's clock, not this process's", async () => {
    // Pretend this server runs an hour ahead of Postgres. Attempt 3 backs off
    // eight minutes, and it has to be eight minutes in *database* time —
    // `claimJob` compares `runAfter` against `NOW()`, so a client-side
    // timestamp would park the job an hour and eight minutes out.
    const job = { ...(await claimed(99)), attempts: 3 };

    const realNow = Date.now;
    Date.now = () => realNow() + 60 * MINUTE;
    try {
      await queue.failJob(job, new Error("boom"));
    } finally {
      Date.now = realNow;
    }

    const stored = await readJob(job.id);
    const delay = stored.runAfter.getTime() - (await dbNow()).getTime();
    assert.ok(
      Math.abs(delay - 8 * MINUTE) < MINUTE,
      `runAfter was ${Math.round(delay / 1000)}s out, expected ~480s`,
    );
  });

  dbIt("backs off 30s, 2m, 8m, 32m, then caps at 2h", async () => {
    const expected = [30_000, 2 * MINUTE, 8 * MINUTE, 32 * MINUTE, 120 * MINUTE];

    for (const [index, wanted] of expected.entries()) {
      const attempt = index + 1;
      const job = { ...(await claimed(99)), attempts: attempt };
      const result = await queue.failJob(job, new Error("boom"));
      assert.equal(result.willRetry, true);
      assert.equal(
        result.willRetry && result.retryInMs,
        wanted,
        `attempt ${attempt}`,
      );
    }
  });

  dbIt("stays capped at two hours for a high attempt count", async () => {
    const job = { ...(await claimed(99)), attempts: 20 };
    const result = await queue.failJob(job, new Error("boom"));
    assert.equal(result.willRetry && result.retryInMs, 120 * MINUTE);
  });

  dbIt("gives up once the attempts are exhausted", async () => {
    const job = await claimed(1); // claiming already spent the only attempt
    const result = await queue.failJob(job, new Error("still broken"));

    assert.equal(result.willRetry, false);

    const stored = await readJob(job.id);
    assert.equal(stored.status, "FAILED");
    assert.equal(stored.lastError, "still broken");
    assert.ok(stored.completedAt);
    assert.equal(stored.lockedBy, null);
  });

  dbIt("fails a non-retryable error immediately, with attempts to spare", async () => {
    const job = await claimed(5);
    const result = await queue.failJob(job, new Error("malformed payload"), {
      retryable: false,
    });

    assert.equal(result.willRetry, false);
    assert.equal((await readJob(job.id)).status, "FAILED");
    // The point of the flag: four attempts were left and none was burned.
    assert.equal((await readJob(job.id)).attempts, 1);
  });

  dbIt("accepts a thrown value that is not an Error", async () => {
    const job = await claimed();
    await queue.failJob(job, "a bare string");
    assert.equal((await readJob(job.id)).lastError, "a bare string");
  });

  dbIt("truncates a runaway error message", async () => {
    const job = await claimed();
    await queue.failJob(job, new Error("x".repeat(5000)));
    assert.equal((await readJob(job.id)).lastError?.length, 2000);
  });

  dbIt("leaves a retried job claimable again once its backoff elapses", async () => {
    const job = await claimed();
    await queue.failJob(job, new Error("transient"));
    assert.equal(await queue.claimJob("worker-2"), null);

    await db.$executeRaw`UPDATE "Job" SET "runAfter" = NOW() WHERE id = ${job.id};`;
    const reclaimed = await queue.claimJob("worker-2");
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.attempts, 2);
  });
});

// ---------------------------------------------------------------------------
// retryJob
// ---------------------------------------------------------------------------

describe("retryJob", () => {
  dbIt("resurrects a dead job with a clean slate", async () => {
    await queue.enqueue({ type: "recap.generate", maxAttempts: 1 });
    const claimed = (await queue.claimJob("worker-1"))!;
    await queue.failJob(claimed, new Error("gave up"));
    assert.equal((await readJob(claimed.id)).status, "FAILED");

    const retried = await queue.retryJob(claimed.id);

    assert.equal(retried.status, "PENDING");
    assert.equal(retried.attempts, 0);
    assert.equal(retried.lastError, null);
    assert.equal(retried.completedAt, null);
    assert.equal(retried.lockedAt, null);
    assert.equal(retried.lockedBy, null);
  });

  dbIt("makes the job immediately claimable again", async () => {
    await queue.enqueue({ type: "recap.generate", maxAttempts: 1 });
    const claimed = (await queue.claimJob("worker-1"))!;
    await queue.failJob(claimed, new Error("gave up"));

    await queue.retryJob(claimed.id);

    const reclaimed = await queue.claimJob("worker-2");
    assert.equal(reclaimed?.id, claimed.id);
    // Attempts were reset, so the full budget is available again.
    assert.equal(reclaimed?.attempts, 1);
  });
});

// ---------------------------------------------------------------------------
// newWorkerId
// ---------------------------------------------------------------------------

describe("newWorkerId", () => {
  dbIt("is unique per call", async () => {
    const ids = new Set(Array.from({ length: 100 }, () => queue.newWorkerId()));
    assert.equal(ids.size, 100);
  });

  dbIt("carries the hostname so a stuck lock can be traced", async () => {
    const saved = process.env.HOSTNAME;
    process.env.HOSTNAME = "worker-box-3";
    try {
      assert.match(queue.newWorkerId(), /^worker-box-3-[0-9a-f]{8}$/);
    } finally {
      if (saved === undefined) delete process.env.HOSTNAME;
      else process.env.HOSTNAME = saved;
    }
  });
});
