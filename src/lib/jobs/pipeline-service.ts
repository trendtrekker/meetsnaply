import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { enqueue, retryJob } from "./queue";

/**
 * Host-facing controls for the recap pipeline, independent of transport.
 *
 * Both entry points verify the caller hosts the meeting behind the job. That
 * check is the whole security story here: a job id is guessable, and retrying
 * someone else's transcription would spend their provider budget.
 */

/** Verifies the caller hosts the booking a job belongs to. */
async function ownsJob(userId: string, jobId: string) {
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

export async function retryPipelineJobFor(
  userId: string,
  jobId: string,
  uid?: string,
): Promise<{ ok: boolean }> {
  if (!(await ownsJob(userId, jobId))) return { ok: false };

  await retryJob(jobId);
  if (uid) revalidatePath(`/dashboard/bookings/${uid}`);
  return { ok: true };
}

/**
 * Restarts the pipeline for a meeting whose recording exists but never
 * progressed — a webhook that never arrived, or a job dead-lettered before the
 * cause was fixed.
 */
export async function reprocessRecordingFor(
  userId: string,
  uid: string,
): Promise<{ ok: boolean }> {
  const booking = await db.booking.findFirst({
    where: { uid, hostId: userId },
    select: { recording: { select: { id: true, externalId: true } } },
  });
  if (!booking?.recording) return { ok: false };

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
  return { ok: true };
}
