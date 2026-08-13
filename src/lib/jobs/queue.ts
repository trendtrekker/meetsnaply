import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Postgres-backed work queue.
 *
 * Jobs are claimed with `FOR UPDATE SKIP LOCKED`, which is what makes it safe
 * to run several workers: each `UPDATE ... RETURNING` takes a distinct row and
 * concurrent claimers skip locked rows instead of blocking on them.
 */

export type JobType =
  | "booking.confirmation"
  | "booking.cancelled"
  | "booking.rescheduled"
  | "booking.reminder"
  | "recording.process"
  | "transcript.generate"
  | "recap.generate"
  | "recap.send"
  | "recording.purge";

export interface EnqueueOptions {
  type: JobType;
  payload?: Prisma.InputJsonValue;
  /** Collapses duplicate enqueues onto one row. */
  dedupeKey?: string;
  delayMs?: number;
  maxAttempts?: number;
}

/** Jobs a worker abandoned (crash, deploy) are reclaimed after this. */
const LOCK_TIMEOUT_MS = 10 * 60_000;

/** Backoff: 30s, 2m, 8m, 32m, 2h — capped. */
function backoffMs(attempt: number) {
  return Math.min(30_000 * 4 ** (attempt - 1), 2 * 60 * 60_000);
}

/**
 * Adds a job to the queue.
 *
 * Raw SQL for one reason: **the database must be the only clock.** Prisma fills
 * `@default(now())` from the application's clock, so a server running even a few
 * hundred milliseconds ahead of Postgres writes a `runAfter` in the database's
 * future — and `claimJob` compares against `NOW()`, so every job silently
 * stalls by the skew. Computing `runAfter` as `NOW() + interval` inside the
 * INSERT removes the two-clock problem entirely.
 *
 * `ON CONFLICT DO NOTHING` also makes deduplication atomic. NULL never conflicts
 * in a unique index, so jobs without a `dedupeKey` always insert.
 */
export async function enqueue(options: EnqueueOptions) {
  const id = randomUUID();
  const delaySeconds = (options.delayMs ?? 0) / 1000;

  const rows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "Job" (
      id, type, payload, "dedupeKey", "maxAttempts", "runAfter", "createdAt", "updatedAt"
    )
    VALUES (
      ${id},
      ${options.type},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      ${options.dedupeKey ?? null},
      ${options.maxAttempts ?? 5},
      NOW() + make_interval(secs => ${delaySeconds}),
      NOW(),
      NOW()
    )
    ON CONFLICT ("dedupeKey") DO NOTHING
    RETURNING id;
  `;

  // No row returned means an existing job already covers this work. Return it
  // rather than null so callers always get something addressable.
  if (rows.length === 0 && options.dedupeKey) {
    const existing = await db.job.findUnique({
      where: { dedupeKey: options.dedupeKey },
    });
    if (existing) return existing;
  }

  return db.job.findUniqueOrThrow({ where: { id } });
}

/**
 * Puts a dead job back in the queue, clearing its failure state.
 *
 * `runAfter = NOW()` in SQL rather than a client timestamp — this is the
 * immediate-retry path, so it is exactly where clock skew would be felt.
 */
export async function retryJob(id: string) {
  await db.$executeRaw`
    UPDATE "Job" SET
      status = 'PENDING',
      attempts = 0,
      "runAfter" = NOW(),
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "lastError" = NULL,
      "completedAt" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${id};
  `;
  return db.job.findUniqueOrThrow({ where: { id } });
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * Atomically claims one runnable job.
 *
 * Raw SQL because Prisma's query API can't express `SKIP LOCKED`, and without
 * it two workers polling at the same moment would fight over the same row.
 */
export async function claimJob(workerId: string): Promise<ClaimedJob | null> {
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS);

  const rows = await db.$queryRaw<
    {
      id: string;
      type: string;
      payload: unknown;
      attempts: number;
      maxAttempts: number;
    }[]
  >`
    UPDATE "Job" SET
      status = 'RUNNING',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      attempts = attempts + 1,
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE "runAfter" <= NOW()
        AND (
          status = 'PENDING'
          -- Reclaim jobs whose worker died mid-run.
          OR (status = 'RUNNING' AND "lockedAt" < ${staleBefore})
        )
      ORDER BY "runAfter" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, attempts, "maxAttempts";
  `;

  return rows[0] ?? null;
}

export async function completeJob(id: string) {
  await db.job.update({
    where: { id },
    data: {
      status: "DONE",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
}

/**
 * Records a failure and either schedules a retry or gives up.
 *
 * `retryable: false` means the failure is deterministic — a malformed payload,
 * a permanently missing record, a provider rejecting the input. Retrying those
 * just burns attempts, so they go straight to FAILED.
 */
export async function failJob(
  job: ClaimedJob,
  error: unknown,
  options: { retryable?: boolean } = {},
) {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = options.retryable ?? true;
  const exhausted = job.attempts >= job.maxAttempts;

  if (!retryable || exhausted) {
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        lastError: message.slice(0, 2000),
        lockedAt: null,
        lockedBy: null,
        completedAt: new Date(),
      },
    });
    return { willRetry: false as const };
  }

  const delay = backoffMs(job.attempts);

  // Raw SQL for the same reason `enqueue` uses it: `runAfter` is a schedule,
  // and `claimJob` compares it against the database's `NOW()`. Computing it
  // from this process's clock would shift every retry by however far that clock
  // has drifted from Postgres — ahead, and the job sleeps through its backoff;
  // behind, and it wakes early.
  await db.$executeRaw`
    UPDATE "Job" SET
      status = 'PENDING',
      "lastError" = ${message.slice(0, 2000)},
      "runAfter" = NOW() + make_interval(secs => ${delay / 1000}),
      "lockedAt" = NULL,
      "lockedBy" = NULL,
      "updatedAt" = NOW()
    WHERE id = ${job.id};
  `;
  return { willRetry: true as const, retryInMs: delay };
}

export function newWorkerId() {
  return `${process.env.HOSTNAME ?? "local"}-${randomUUID().slice(0, 8)}`;
}
