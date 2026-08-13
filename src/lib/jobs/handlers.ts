import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { enqueue } from "./queue";
import { JobSkipped, PermanentJobError } from "./errors";
import {
  DailyError,
  deleteRecording,
  getRecording,
  getRecordingDownloadUrl,
  isDailyConfigured,
} from "@/lib/video/daily";
import {
  TranscriptionError,
  isTranscriptionConfigured,
  transcribeUrl,
} from "@/lib/transcription/deepgram";
import {
  RecapRefusedError,
  generateRecap,
  isRecapConfigured,
} from "@/lib/recap/generate";
import { EmailError, sendEmail } from "@/lib/email/send";
import {
  recapHtml,
  recapSubject,
  recapText,
} from "@/lib/email/templates/recap";
import {
  sendBookingConfirmation,
  sendBookingReminder,
  sendCancellationNotice,
  sendRescheduleNotice,
} from "@/lib/bookings/notifications";
import { appUrl } from "@/lib/app-url";

/**
 * The pipeline, one stage per handler:
 *
 *   recording.process  → provider says the recording is ready; store the audio ref
 *   transcript.generate → transcribe with diarization, persist segments
 *   recap.generate     → summarise with Claude
 *   recap.send         → email every consenting attendee
 *   recording.purge    → delete audio once the retention window closes
 *
 * Each stage enqueues the next rather than calling it, so a failure is retried in
 * isolation: a transient email outage re-sends the email without paying for
 * transcription and summarisation again.
 */

export type JobHandler = (payload: unknown) => Promise<string>;

const bookingPayload = z.object({ bookingId: z.string().min(1) });
const recordingPayload = z.object({
  recordingId: z.string().min(1),
  externalId: z.string().min(1).optional(),
});

function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // A malformed payload is a bug, not a blip — never worth retrying.
    throw new PermanentJobError(
      `Invalid job payload: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
    );
  }
  return parsed.data;
}

/** Maps provider errors onto the queue's retryable/permanent distinction. */
function rethrowProviderError(error: unknown): never {
  if (
    (error instanceof DailyError || error instanceof TranscriptionError) &&
    error.permanent
  ) {
    throw new PermanentJobError(error.message);
  }
  if (error instanceof EmailError && error.permanent) {
    throw new PermanentJobError(error.message);
  }
  throw error;
}

// ---------------------------------------------------------------------------
// 1. Recording ready
// ---------------------------------------------------------------------------

/**
 * Resolves a finished provider recording into a stored audio reference.
 *
 * Runs as a job rather than inline in the webhook because the provider often
 * reports "ready" before the media is actually downloadable — a 409 here just
 * retries with backoff instead of losing the recording.
 */
const processRecording: JobHandler = async (payload) => {
  const { recordingId, externalId } = parsePayload(recordingPayload, payload);

  const recording = await db.meetingRecording.findUnique({
    where: { id: recordingId },
    include: { booking: { select: { id: true, eventTypeId: true } } },
  });
  if (!recording) {
    throw new PermanentJobError(`Recording ${recordingId} no longer exists`);
  }
  if (recording.purgedAt) {
    throw new JobSkipped("Recording was already purged");
  }

  const providerId = externalId ?? recording.externalId;
  if (!providerId) {
    throw new PermanentJobError("Recording has no provider id to fetch");
  }

  if (!isDailyConfigured()) {
    throw new PermanentJobError(
      "DAILY_API_KEY is not set, so the recording cannot be fetched",
    );
  }

  try {
    const remote = await getRecording(providerId);

    if (remote.status !== "finished") {
      // Still processing on their side; come back shortly.
      throw new DailyError(`Recording status is "${remote.status}"`, 409);
    }

    const downloadUrl = await getRecordingDownloadUrl(providerId);

    const eventType = await db.eventType.findUnique({
      where: { id: recording.booking.eventTypeId },
      select: {
        transcriptionEnabled: true,
        recordingRetentionDays: true,
      },
    });

    const retentionDays = eventType?.recordingRetentionDays ?? 30;

    await db.meetingRecording.update({
      where: { id: recording.id },
      data: {
        externalId: providerId,
        status: "PROCESSING",
        durationSeconds: remote.duration ?? null,
        expiresAt: new Date(Date.now() + retentionDays * 86_400_000),
      },
    });

    // Schedule the purge now, so a failure further down the pipeline can never
    // leave audio sitting around indefinitely.
    await enqueue({
      type: "recording.purge",
      payload: { recordingId: recording.id },
      dedupeKey: `purge:${recording.id}`,
      delayMs: retentionDays * 86_400_000,
      maxAttempts: 8,
    });

    if (!eventType?.transcriptionEnabled) {
      await db.meetingRecording.update({
        where: { id: recording.id },
        data: { status: "READY" },
      });
      return "Recording stored; transcription is off for this event type";
    }

    await enqueue({
      type: "transcript.generate",
      // The signed URL expires, so it is passed through the queue rather than
      // stored — and re-fetched if the transcription job retries later.
      payload: { recordingId: recording.id, audioUrl: downloadUrl },
      dedupeKey: `transcript:${recording.id}`,
    });

    return `Recording ready (${remote.duration ?? "?"}s); transcription queued`;
  } catch (error) {
    rethrowProviderError(error);
  }
};

// ---------------------------------------------------------------------------
// 2. Transcription
// ---------------------------------------------------------------------------

const transcriptPayload = z.object({
  recordingId: z.string().min(1),
  audioUrl: z.string().url().optional(),
});

const generateTranscript: JobHandler = async (payload) => {
  const { recordingId, audioUrl } = parsePayload(transcriptPayload, payload);

  const recording = await db.meetingRecording.findUnique({
    where: { id: recordingId },
    include: { transcript: { select: { id: true, status: true } } },
  });
  if (!recording) {
    throw new PermanentJobError(`Recording ${recordingId} no longer exists`);
  }
  if (recording.purgedAt) {
    throw new JobSkipped("Recording was purged before it could be transcribed");
  }
  if (recording.transcript?.status === "READY") {
    throw new JobSkipped("Transcript already exists");
  }
  if (!isTranscriptionConfigured()) {
    throw new PermanentJobError("DEEPGRAM_API_KEY is not set");
  }

  // The URL from the enqueueing job may have expired between attempts.
  let url = audioUrl;
  if (!url) {
    if (!recording.externalId || !isDailyConfigured()) {
      throw new PermanentJobError("No audio URL available for this recording");
    }
    url = await getRecordingDownloadUrl(recording.externalId).catch(
      rethrowProviderError,
    );
  }

  const transcript = await db.transcript.upsert({
    where: { recordingId: recording.id },
    create: {
      recordingId: recording.id,
      status: "PROCESSING",
      provider: "deepgram",
    },
    update: { status: "PROCESSING" },
  });

  try {
    const result = await transcribeUrl(url);

    await db.$transaction([
      // Clear prior segments so a retry replaces rather than duplicates them.
      db.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
      db.transcript.update({
        where: { id: transcript.id },
        data: {
          status: "READY",
          language: result.language,
          fullText: result.fullText,
        },
      }),
      db.transcriptSegment.createMany({
        data: result.segments.map((segment) => ({
          transcriptId: transcript.id,
          speaker: segment.speaker,
          startMs: segment.startMs,
          endMs: segment.endMs,
          text: segment.text,
          confidence: segment.confidence,
        })),
      }),
      db.meetingRecording.update({
        where: { id: recording.id },
        data: { status: "READY" },
      }),
    ]);

    if (result.segments.length === 0) {
      return "Transcript is empty (silent recording); no recap queued";
    }

    await enqueue({
      type: "recap.generate",
      payload: { bookingId: recording.bookingId },
      dedupeKey: `recap:${recording.bookingId}`,
    });

    return `Transcribed ${result.segments.length} segments across ${result.speakerLabels.length} speakers`;
  } catch (error) {
    await db.transcript.update({
      where: { id: transcript.id },
      data: { status: "FAILED" },
    });
    rethrowProviderError(error);
  }
};

// ---------------------------------------------------------------------------
// 3. Recap generation
// ---------------------------------------------------------------------------

const generateRecapJob: JobHandler = async (payload) => {
  const { bookingId } = parsePayload(bookingPayload, payload);

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      host: { select: { name: true } },
      eventType: { select: { title: true, sendRecapToAttendees: true } },
      attendees: { select: { name: true } },
      recap: { select: { id: true } },
      recording: {
        include: {
          transcript: {
            select: { fullText: true, status: true },
          },
        },
      },
    },
  });

  if (!booking) {
    throw new PermanentJobError(`Booking ${bookingId} no longer exists`);
  }
  if (booking.recap) {
    throw new JobSkipped("Recap already generated");
  }

  const transcript = booking.recording?.transcript;
  if (!transcript || transcript.status !== "READY" || !transcript.fullText) {
    throw new PermanentJobError("No ready transcript to summarise");
  }
  if (!isRecapConfigured()) {
    throw new PermanentJobError("ANTHROPIC_API_KEY is not set");
  }

  const speakerLabels = await db.transcriptSegment
    .findMany({
      where: { transcript: { recordingId: booking.recording!.id } },
      select: { speaker: true },
      distinct: ["speaker"],
    })
    .then((rows) => rows.map((row) => row.speaker));

  let result;
  try {
    result = await generateRecap({
      title: booking.eventType.title,
      transcript: transcript.fullText,
      participants: [
        booking.host.name,
        ...booking.attendees.map((attendee) => attendee.name),
      ],
      speakerLabels,
    });
  } catch (error) {
    if (error instanceof RecapRefusedError) {
      throw new PermanentJobError(error.message);
    }
    throw error;
  }

  await db.meetingRecap.create({
    data: {
      bookingId: booking.id,
      summary: result.summary,
      decisions: result.decisions,
      actionItems: result.actionItems,
      openQuestions: result.openQuestions,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  });

  if (booking.eventType.sendRecapToAttendees) {
    await enqueue({
      type: "recap.send",
      payload: { bookingId: booking.id },
      dedupeKey: `recap-send:${booking.id}`,
    });
    return `Recap generated (${result.usage.inputTokens} in / ${result.usage.outputTokens} out); delivery queued`;
  }

  return `Recap generated (${result.usage.inputTokens} in / ${result.usage.outputTokens} out); host-only, not emailed`;
};

// ---------------------------------------------------------------------------
// 4. Recap delivery
// ---------------------------------------------------------------------------

const sendRecapJob: JobHandler = async (payload) => {
  const { bookingId } = parsePayload(bookingPayload, payload);
  const origin = appUrl();

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      host: { select: { name: true, email: true, timeZone: true } },
      eventType: { select: { title: true, sendRecapToAttendees: true } },
      attendees: true,
      recording: { select: { expiresAt: true } },
      recap: { include: { deliveries: true } },
    },
  });

  if (!booking?.recap) {
    throw new PermanentJobError("No recap to send");
  }
  if (!booking.eventType.sendRecapToAttendees) {
    throw new JobSkipped("Recap delivery is disabled for this event type");
  }

  // Only attendees who accepted recording get the transcript. Consent to being
  // recorded is the basis for sending it, so an attendee without it is skipped
  // even though they were on the call.
  const recipients = booking.attendees.filter(
    (attendee) => attendee.email && attendee.recordingConsentAt,
  );

  const retentionNote = booking.recording?.expiresAt
    ? `The recording is deleted on ${booking.recording.expiresAt.toISOString().slice(0, 10)}.`
    : null;

  const alreadySent = new Set(
    booking.recap.deliveries
      .filter((delivery) => delivery.sentAt)
      .map((delivery) => delivery.email),
  );

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const attendee of recipients) {
    // A retry must not email anyone twice.
    if (alreadySent.has(attendee.email)) {
      skipped++;
      continue;
    }

    const data = {
      recipientName: attendee.name,
      hostName: booking.host.name,
      meetingTitle: booking.eventType.title,
      startTime: booking.startTime,
      timeZone: attendee.timeZone || booking.timeZone,
      summary: booking.recap.summary,
      decisions: booking.recap.decisions,
      actionItems: Array.isArray(booking.recap.actionItems)
        ? (booking.recap.actionItems as {
            text: string;
            owner: string | null;
            due: string | null;
          }[])
        : [],
      openQuestions: booking.recap.openQuestions,
      transcriptUrl: `${origin}/booking/${booking.uid}/transcript`,
      retentionNote,
    };

    try {
      const result = await sendEmail({
        to: attendee.email,
        subject: recapSubject(data),
        html: recapHtml(data),
        text: recapText(data),
        replyTo: booking.host.email,
      });

      if (!result.delivered) {
        skipped++;
        continue;
      }

      await db.recapDelivery.upsert({
        where: {
          recapId_email: { recapId: booking.recap.id, email: attendee.email },
        },
        create: {
          recapId: booking.recap.id,
          attendeeId: attendee.id,
          email: attendee.email,
          sentAt: new Date(),
          providerMessageId: result.providerMessageId,
        },
        update: {
          sentAt: new Date(),
          failedAt: null,
          error: null,
          providerMessageId: result.providerMessageId,
        },
      });
      sent++;
    } catch (error) {
      // One bad address must not block the rest of the room.
      const message = error instanceof Error ? error.message : String(error);
      await db.recapDelivery.upsert({
        where: {
          recapId_email: { recapId: booking.recap.id, email: attendee.email },
        },
        create: {
          recapId: booking.recap.id,
          attendeeId: attendee.id,
          email: attendee.email,
          failedAt: new Date(),
          error: message.slice(0, 500),
        },
        update: { failedAt: new Date(), error: message.slice(0, 500) },
      });
      failed++;
    }
  }

  if (sent > 0 || recipients.length === 0) {
    await db.meetingRecap.update({
      where: { id: booking.recap.id },
      data: { sentAt: new Date() },
    });
  }

  // Surfacing this as a failure gets the remaining addresses retried with
  // backoff, while the successful ones are skipped by the guard above.
  if (failed > 0) {
    throw new Error(
      `Recap delivered to ${sent}/${recipients.length}; ${failed} failed`,
    );
  }

  return `Recap delivered to ${sent} attendee(s), ${skipped} skipped`;
};

// ---------------------------------------------------------------------------
// 5. Retention purge
// ---------------------------------------------------------------------------

/**
 * Deletes meeting audio once its retention window closes.
 *
 * The transcript and recap survive — they are the product. The audio is the
 * sensitive artefact and the one we promised to delete, so this job is what makes
 * `expiresAt` a real guarantee rather than a column nobody reads.
 */
const purgeRecording: JobHandler = async (payload) => {
  const { recordingId } = parsePayload(recordingPayload, payload);

  const recording = await db.meetingRecording.findUnique({
    where: { id: recordingId },
  });
  if (!recording) {
    throw new JobSkipped("Recording row is already gone");
  }
  if (recording.purgedAt) {
    throw new JobSkipped("Already purged");
  }
  if (recording.expiresAt && recording.expiresAt > new Date()) {
    throw new PermanentJobError(
      "Retention window was extended; purge rescheduled separately",
    );
  }

  if (recording.externalId && isDailyConfigured()) {
    await deleteRecording(recording.externalId).catch(rethrowProviderError);
  }

  await db.meetingRecording.update({
    where: { id: recording.id },
    data: {
      status: "DELETED",
      purgedAt: new Date(),
      audioUrl: null,
      externalId: null,
    },
  });

  return "Recording audio purged; transcript and recap retained";
};

// ---------------------------------------------------------------------------
// Booking lifecycle email
// ---------------------------------------------------------------------------

const confirmationJob: JobHandler = async (payload) => {
  const { bookingId } = parsePayload(bookingPayload, payload);
  return sendBookingConfirmation(bookingId);
};

const reminderJob: JobHandler = async (payload) => {
  const { bookingId, minutesBefore } = parsePayload(
    bookingPayload.extend({ minutesBefore: z.number().int().positive() }),
    payload,
  );
  return sendBookingReminder(bookingId, minutesBefore);
};

const actorPayload = bookingPayload.extend({
  actor: z.enum(["host", "invitee"]),
});

const cancellationJob: JobHandler = async (payload) => {
  const { bookingId, actor } = parsePayload(actorPayload, payload);
  return sendCancellationNotice(bookingId, actor);
};

const rescheduleJob: JobHandler = async (payload) => {
  const { bookingId, actor } = parsePayload(actorPayload, payload);
  return sendRescheduleNotice(bookingId, actor);
};

export const HANDLERS: Record<string, JobHandler> = {
  "booking.confirmation": confirmationJob,
  "booking.cancelled": cancellationJob,
  "booking.rescheduled": rescheduleJob,
  "booking.reminder": reminderJob,
  "recording.process": processRecording,
  "transcript.generate": generateTranscript,
  "recap.generate": generateRecapJob,
  "recap.send": sendRecapJob,
  "recording.purge": purgeRecording,
};
