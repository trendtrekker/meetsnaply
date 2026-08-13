import "dotenv/config";
import { newWorkerId } from "../src/lib/jobs/queue";
import { drainQueue } from "../src/lib/jobs/runner";

/**
 * Long-running worker for local development and any host that can run a process.
 *
 * Serverless deployments should hit /api/jobs/run on a schedule instead — same
 * queue, same handlers, different trigger.
 */

const POLL_INTERVAL_MS = 5_000;
const workerId = newWorkerId();

let running = true;
let draining = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (!running) process.exit(1); // second signal: don't wait
    console.log(`\n[worker] ${signal} received, finishing current job…`);
    running = false;
  });
}

function log(message: string) {
  console.log(`[worker ${workerId}] ${message}`);
}

async function tick() {
  if (draining) return;
  draining = true;
  try {
    const results = await drainQueue({ workerId, max: 5 });
    for (const result of results) {
      const symbol =
        result.outcome === "done"
          ? "✓"
          : result.outcome === "skipped"
            ? "–"
            : result.outcome === "retrying"
              ? "↻"
              : "✗";
      log(`${symbol} ${result.type} ${result.outcome}: ${result.detail}`);
    }
  } catch (error) {
    // Keep polling: a transient database blip must not kill the worker.
    log(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    draining = false;
  }
}

async function main() {
  log("started");
  while (running) {
    await tick();
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  log("stopped");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
