import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Daily.co rooms and recordings over plain fetch.
 *
 * Daily is the provider because it records server-side and hands back a
 * downloadable audio track — the two things the transcription pipeline needs.
 * Everything provider-specific is confined to this file; the pipeline talks to
 * it through `src/lib/video/index.ts`.
 */

const API_BASE = "https://api.daily.co/v1";

export class DailyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DailyError";
    this.status = status;
  }
  /** 4xx other than 429 won't succeed on retry. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 429;
  }
}

export function isDailyConfigured() {
  return Boolean(process.env.DAILY_API_KEY);
}

function apiKey() {
  const key = process.env.DAILY_API_KEY;
  if (!key) throw new Error("DAILY_API_KEY is not set.");
  return key;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (cause) {
    // Network failure: no status, so treat as transient.
    throw new DailyError(`Could not reach Daily: ${String(cause)}`, 503);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DailyError(
      `Daily ${response.status}: ${body.slice(0, 300)}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface DailyRoom {
  name: string;
  url: string;
}

/**
 * Creates a room for one booking.
 *
 * `enable_recording: "cloud"` records server-side rather than in the browser, so
 * the recording survives a participant closing their laptop. The room expires
 * shortly after the meeting window so abandoned rooms don't accumulate.
 */
export async function createRoom(options: {
  bookingUid: string;
  startTime: Date;
  endTime: Date;
  record: boolean;
}): Promise<DailyRoom> {
  const expiry = Math.floor(options.endTime.getTime() / 1000) + 60 * 60;

  return call<DailyRoom>("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name: `meetsnaply-${options.bookingUid}`,
      privacy: "public",
      properties: {
        exp: expiry,
        // Don't let anyone in more than 15 minutes early.
        nbf: Math.floor(options.startTime.getTime() / 1000) - 15 * 60,
        enable_recording: options.record ? "cloud" : undefined,
        // Kick off recording automatically; relying on a human to press record
        // is how meetings end up with no transcript.
        start_cloud_recording: options.record,
        enable_prejoin_ui: true,
        eject_at_room_exp: true,
      },
    }),
  });
}

export async function deleteRoom(name: string): Promise<void> {
  try {
    await call<void>(`/rooms/${encodeURIComponent(name)}`, { method: "DELETE" });
  } catch (error) {
    // Already gone is the desired end state.
    if (error instanceof DailyError && error.status === 404) return;
    throw error;
  }
}

export interface DailyRecording {
  id: string;
  room_name: string;
  status: string;
  duration?: number;
  tracks?: { type: string; download_url?: string }[];
}

export async function getRecording(id: string): Promise<DailyRecording> {
  return call<DailyRecording>(`/recordings/${encodeURIComponent(id)}`);
}

/**
 * Short-lived download link for a recording.
 *
 * Deliberately not stored: the URL expires, and persisting one would leave a
 * live handle to meeting audio sitting in the database.
 */
export async function getRecordingDownloadUrl(id: string): Promise<string> {
  const payload = await call<{ download_link?: string }>(
    `/recordings/${encodeURIComponent(id)}/access-link`,
  );
  if (!payload.download_link) {
    throw new DailyError("Recording has no download link yet", 409);
  }
  return payload.download_link;
}

export async function deleteRecording(id: string): Promise<void> {
  try {
    await call<void>(`/recordings/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof DailyError && error.status === 404) return;
    throw error;
  }
}

/**
 * Verifies a Daily webhook's HMAC signature.
 *
 * Unsigned webhooks are an open door: anyone who guesses the URL could post a
 * fabricated "recording ready" event and make us fetch and transcribe an
 * arbitrary file. Compared with `timingSafeEqual` so the check can't be probed
 * byte by byte.
 */
export function verifyWebhookSignature(options: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
}): boolean {
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret) return false;
  if (!options.timestamp || !options.signature) return false;

  // Reject replays of a captured delivery.
  const age = Math.abs(Date.now() / 1000 - Number(options.timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = createHmac("sha256", secret)
    .update(`${options.timestamp}.${options.rawBody}`)
    .digest("hex");

  const received = Buffer.from(options.signature, "utf8");
  const computed = Buffer.from(expected, "utf8");
  if (received.length !== computed.length) return false;
  return timingSafeEqual(received, computed);
}
