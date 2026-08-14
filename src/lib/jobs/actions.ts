"use server";

import { requireUser } from "@/lib/auth";
import {
  reprocessRecordingFor,
  retryPipelineJobFor,
} from "./pipeline-service";

/**
 * Form actions for the pipeline panel.
 *
 * The panel's *read* — `pipelineJobsForBooking` — lives in ./pipeline-service
 * rather than here. A `"use server"` module may only export async functions and
 * drags `requireUser` (and with it next/navigation) into anything that touches
 * it, which is more than a query should cost.
 */

export async function retryPipelineJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  if (!jobId) return;

  await retryPipelineJobFor(
    user.id,
    jobId,
    String(formData.get("uid") ?? "") || undefined,
  );
}

export async function reprocessRecording(formData: FormData) {
  const user = await requireUser();
  const uid = String(formData.get("uid") ?? "");
  if (!uid) return;

  await reprocessRecordingFor(user.id, uid);
}
