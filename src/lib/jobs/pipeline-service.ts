import "server-only";
import { refreshPath } from "@/lib/cache";
import { db } from "@/lib/db";
import { enqueue, retryJob, type JobType } from "./queue";

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
  if (uid) refreshPath(`/dashboard/bookings/${uid}`);
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

  refreshPath(`/dashboard/bookings/${uid}`);
  return { ok: true };
}
