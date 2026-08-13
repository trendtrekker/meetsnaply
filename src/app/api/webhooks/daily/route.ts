import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { verifyWebhookSignature } from "@/lib/video/daily";

/**
 * Recording lifecycle webhook.
 *
 * Deliberately thin: it verifies the signature, correlates the event to a
 * booking, and enqueues. Nothing slow happens here — the provider retries on
 * timeout, and doing the transcription inline would guarantee timeouts.
 */

interface DailyWebhookEvent {
  type?: string;
  payload?: {
    recording_id?: string;
    room_name?: string;
    duration?: number;
  };
}

export async function POST(request: NextRequest) {
  // Read the raw body: the HMAC is over exact bytes, so parsing first and
  // re-serialising would change them and break verification.
  const rawBody = await request.text();

  const valid = verifyWebhookSignature({
    rawBody,
    timestamp: request.headers.get("x-webhook-timestamp"),
    signature: request.headers.get("x-webhook-signature"),
  });

  if (!valid) {
    // 401, not 400: an unverified caller gets told nothing about the payload.
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let event: DailyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as DailyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const roomName = event.payload?.room_name;
  const externalId = event.payload?.recording_id;

  // Only act on a finished recording. Other events (started, participant
  // joined) are acknowledged so the provider stops retrying them.
  if (event.type !== "recording.ready-to-download" || !roomName || !externalId) {
    return NextResponse.json({ ignored: event.type ?? "unknown" });
  }

  const recording = await db.meetingRecording.findFirst({
    where: { roomName },
    select: { id: true },
  });

  if (!recording) {
    // 200, not 404: a retry can't fix an unknown room, and a non-2xx here would
    // make the provider hammer this endpoint until it gives up.
    return NextResponse.json({ ignored: "no recording for room" });
  }

  await db.meetingRecording.update({
    where: { id: recording.id },
    data: {
      externalId,
      status: "PROCESSING",
      durationSeconds: event.payload?.duration ?? null,
    },
  });

  await enqueue({
    type: "recording.process",
    payload: { recordingId: recording.id, externalId },
    // Providers deliver the same event more than once; this collapses the
    // duplicates onto a single job.
    dedupeKey: `process:${externalId}`,
  });

  return NextResponse.json({ queued: recording.id });
}
