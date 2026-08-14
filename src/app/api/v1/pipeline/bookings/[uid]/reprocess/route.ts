import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { notFound, ok, unauthorized } from "@/lib/api/respond";
import { reprocessRecordingFor } from "@/lib/jobs/pipeline-service";

/** Restarts the recap pipeline for a meeting whose recording never progressed. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const result = await reprocessRecordingFor(user.id, (await params).uid);
  if (!result.ok) return notFound("No recording to reprocess.");

  return ok({ queued: true });
}
