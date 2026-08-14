import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Best-effort page-cache invalidation.
 *
 * `revalidatePath` only works inside a request scope — it reaches for a store
 * that Next puts in place per request, and throws an invariant when there
 * isn't one. The services that call it are reachable from places that have no
 * such scope: the worker process in scripts/worker.ts, one-off scripts, and
 * tests that drive the services directly.
 *
 * In those places there is no rendered page to invalidate, so there is nothing
 * to do and nothing has gone wrong. Swallowing the invariant keeps a cache
 * hint from failing the write it was meant to follow — a booking that exists
 * must not be reported as failed because a cache could not be poked.
 *
 * Only the missing-scope invariant is swallowed. Anything else rethrows.
 */
export function refreshPath(path: string): void {
  try {
    revalidatePath(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("static generation store missing")) return;
    throw error;
  }
}
