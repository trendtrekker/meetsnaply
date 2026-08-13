import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { drainQueue } from "@/lib/jobs/runner";

/**
 * HTTP trigger for the queue, for hosts that can't run a long-lived process.
 *
 * Two callers, one handler:
 *  - Vercel Cron, which issues a **GET** and sends `Authorization: Bearer
 *    $CRON_SECRET` when that variable is set on the project.
 *  - Anything else (your own scheduler, `curl`), which POSTs with
 *    `Authorization: Bearer $JOBS_RUN_SECRET`.
 *
 * `scripts/worker.ts` is the same drain loop for hosts that can keep a process
 * alive, and is the better option — see the note on duration below.
 */

/**
 * Serverless functions are capped by plan: 60s on Vercel Hobby, longer on Pro.
 * Transcription and recap generation can exceed either, which is why the drain
 * size is small here and why the pipeline really wants a real worker process.
 */
export const maxDuration = 60;

function matches(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  // Length check first: timingSafeEqual throws on a mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorized(request: NextRequest) {
  const header = request.headers.get("authorization");
  // Fail closed: with neither secret configured, nothing may drive the queue —
  // an open endpoint here would let anyone run up provider bills.
  return (
    matches(header, process.env.CRON_SECRET) ||
    matches(header, process.env.JOBS_RUN_SECRET)
  );
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Deliberately modest: better to drain a few jobs on every tick than to be
  // killed mid-job at the platform's duration limit.
  const results = await drainQueue({ max: 5 });

  return NextResponse.json({
    drained: results.length,
    results: results.map((result) => ({
      type: result.type,
      outcome: result.outcome,
      detail: result.detail,
    })),
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
