"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueue, retryJob } from "./queue";
import type { JobType } from "./queue";

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

/** Verifies the caller hosts the booking a job belongs to. */
async function assertOwnsJob(userId: string, jobId: string) {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { payload: true },
  });
  if (!job) return false;

  const payload = job.payload as { bookingId?: string; recordingId?: string };
  const bookingId =
    payload.bookingId ??
    (payload.recordingId
      ? (
          await db.meetingRecording.findUnique({
            where: { id: payload.recordingId },
            select: { bookingId: true },
          })
        )?.bookingId
      : undefined);

  if (!bookingId) return false;

  const booking = await db.booking.findFirst({
    where: { id: bookingId, hostId: userId },
    select: { id: true },
  });
  return Boolean(booking);
}

export async function retryPipelineJob(formData: FormData) {
  const user = await requireUser();
  const jobId = String(formData.get("jobId") ?? "");
  const uid = String(formData.get("uid") ?? "");
  if (!jobId) return;

  if (!(await assertOwnsJob(user.id, jobId))) return;

  await retryJob(jobId);
  revalidatePath(`/dashboard/bookings/${uid}`);
}

/**
 * Restarts the pipeline for a meeting whose recording exists but never
 * progressed — a webhook that never arrived, or a job dead-lettered before the
 * cause was fixed.
 */
export async function reprocessRecording(formData: FormData) {
  const user = await requireUser();
  const uid = String(formData.get("uid") ?? "");
  if (!uid) return;

  const booking = await db.booking.findFirst({
    where: { uid, hostId: user.id },
    select: { recording: { select: { id: true, externalId: true } } },
  });
  if (!booking?.recording) return;

  await enqueue({
    type: "recording.process",
    payload: {
      recordingId: booking.recording.id,
      ...(booking.recording.externalId
        ? { externalId: booking.recording.externalId }
        : {}),
    },
    // A fresh key so this bypasses the dedupe on the original job.
    dedupeKey: `process:manual:${booking.recording.id}:${Date.now()}`,
  });

  revalidatePath(`/dashboard/bookings/${uid}`);
}
