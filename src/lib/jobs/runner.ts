import "server-only";
import { HANDLERS } from "./handlers";
import { JobSkipped, PermanentJobError } from "./errors";
import {
  claimJob,
  completeJob,
  failJob,
  newWorkerId,
  type ClaimedJob,
} from "./queue";

export interface RunResult {
  jobId: string;
  type: string;
  outcome: "done" | "retrying" | "failed" | "skipped";
  detail: string;
}

/** Runs one claimed job, translating its outcome into queue state. */
export async function runJob(job: ClaimedJob): Promise<RunResult> {
  const handler = HANDLERS[job.type];

  if (!handler) {
    await failJob(job, `No handler registered for "${job.type}"`, {
      retryable: false,
    });
    return {
      jobId: job.id,
      type: job.type,
      outcome: "failed",
      detail: "unknown job type",
    };
  }

  try {
    const detail = await handler(job.payload);
    await completeJob(job.id);
    return { jobId: job.id, type: job.type, outcome: "done", detail };
  } catch (error) {
    // A skip is a success with nothing to do — usually the work was already
    // done by an earlier attempt or a concurrent worker.
    if (error instanceof JobSkipped) {
      await completeJob(job.id);
      return {
        jobId: job.id,
        type: job.type,
        outcome: "skipped",
        detail: error.message,
      };
    }

    const result = await failJob(job, error, {
      retryable: !(error instanceof PermanentJobError),
    });
    const message = error instanceof Error ? error.message : String(error);

    return {
      jobId: job.id,
      type: job.type,
      outcome: result.willRetry ? "retrying" : "failed",
      detail: result.willRetry
        ? `${message} (retry in ${Math.round(result.retryInMs / 1000)}s)`
        : message,
    };
  }
}

/**
 * Drains up to `max` runnable jobs.
 *
 * Serial on purpose: the stages call rate-limited third-party APIs, and a burst
 * of parallel transcription requests is the fastest way to get throttled. Scale
 * by running more worker processes, which `SKIP LOCKED` already makes safe.
 */
export async function drainQueue(
  options: { max?: number; workerId?: string } = {},
): Promise<RunResult[]> {
  const max = options.max ?? 10;
  const workerId = options.workerId ?? newWorkerId();
  const results: RunResult[] = [];

  for (let i = 0; i < max; i++) {
    const job = await claimJob(workerId);
    if (!job) break;
    results.push(await runJob(job));
  }

  return results;
}
