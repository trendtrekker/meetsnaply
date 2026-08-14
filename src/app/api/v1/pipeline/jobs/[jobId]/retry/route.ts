import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { notFound, ok, unauthorized } from "@/lib/api/respond";
import { retryPipelineJobFor } from "@/lib/jobs/pipeline-service";

/**
 * Puts a dead pipeline job back in the queue.
 *
 * A miss returns 404 whether the job does not exist or belongs to another
 * host — the distinction would confirm the existence of someone else's job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const result = await retryPipelineJobFor(user.id, (await params).jobId);
  if (!result.ok) return notFound("No such job.");

  return ok({ retried: true });
}
