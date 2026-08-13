import "server-only";
import type { LocationType } from "@/generated/prisma/enums";
import { createRoom, deleteRoom, isDailyConfigured } from "./daily";
import { appUrl } from "@/lib/app-url";

export { isDailyConfigured };

export interface ProvisionedRoom {
  /** Join URL for attendees. */
  url: string;
  /** Provider room name, used to correlate recording webhooks back to us. */
  roomName: string | null;
}

/**
 * Provisions a meeting room for a booking.
 *
 * Falls back to a local placeholder URL when no video provider is configured, so
 * the booking flow works end to end in development. The fallback is not
 * recordable — `roomName` is null, which is what stops the pipeline from waiting
 * on a recording that will never arrive.
 */
export async function provisionRoom(options: {
  locationType: LocationType;
  bookingUid: string;
  startTime: Date;
  endTime: Date;
  record: boolean;
}): Promise<ProvisionedRoom | null> {
  if (options.locationType !== "MEETSNAPLY_VIDEO") return null;

  const base = appUrl();

  if (!isDailyConfigured()) {
    return { url: `${base}/call/${options.bookingUid}`, roomName: null };
  }

  try {
    const room = await createRoom({
      bookingUid: options.bookingUid,
      startTime: options.startTime,
      endTime: options.endTime,
      record: options.record,
    });
    return { url: room.url, roomName: room.name };
  } catch (error) {
    // A provider outage must not cost the invitee their booking. They get the
    // placeholder link; the host sees the error on the booking.
    console.error("[video] room provisioning failed", error);
    return { url: `${base}/call/${options.bookingUid}`, roomName: null };
  }
}

/** Best-effort teardown when a booking is cancelled. */
export async function releaseRoom(roomName: string | null | undefined) {
  if (!roomName || !isDailyConfigured()) return;
  try {
    await deleteRoom(roomName);
  } catch (error) {
    console.error("[video] room teardown failed", error);
  }
}
