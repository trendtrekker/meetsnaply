"use server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { JobType } from "./queue";
import {
  reprocessRecordingFor,
  retryPipelineJobFor,
} from "./pipeline-service";

const PIPELINE_TYPES: JobType[] = [
  "recording.process",
  "transcript.generate",
  "recap.generate",
  "recap.send",
  "recording.purge",
];

/** Jobs belonging to one booking, for the pipeline panel. */
export async function pipelineJobsForBooking(bookingId: string) {
  const recording = await db.meetingRecording.findUnique({
    where: { bookingId },
    select: { id: true },
  });

  // Payloads are keyed by either booking or recording id depending on the stage,
  // so both are needed to find every job for one meeting.
  const ids = [bookingId, recording?.id].filter(Boolean) as string[];

  return db.job.findMany({
    where: {
      type: { in: PIPELINE_TYPES },
      OR: ids.flatMap((id) => [
        { payload: { path: ["bookingId"], equals: id } },
        { payload: { path: ["recordingId"], equals: id } },
      ]),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      runAfter: true,
      lastError: true,
      completedAt: true,
    },
  });
}

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
