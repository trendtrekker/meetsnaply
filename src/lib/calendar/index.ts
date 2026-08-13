import "server-only";
import { db } from "@/lib/db";
import type { Interval } from "@/lib/availability/engine";
import { describeLocation } from "@/lib/bookings/locations";
import {
  conflictConnections,
  destinationConnection,
  markConnectionBroken,
} from "./connections";
import {
  GoogleAuthError,
  deleteEvent,
  fetchFreeBusy,
  insertEvent,
  isGoogleConfigured,
  patchEvent,
} from "./google";

export { isGoogleConfigured };

export interface ExternalBusyResult {
  busy: Interval[];
  /** Connections we could not reach. Empty means the answer is complete. */
  failed: { accountEmail: string; reason: string }[];
  /** False when at least one connected calendar could not be consulted. */
  complete: boolean;
}

/**
 * Busy intervals from every connected calendar marked for conflict checking.
 *
 * Never throws. Callers get `complete: false` instead and decide what that
 * means: the booking page still renders (a stale slot is recoverable — the
 * write path re-checks), while the write path refuses (silently double-booking
 * someone's calendar is not recoverable).
 */
export async function getExternalBusy(
  userId: string,
  from: Date,
  to: Date,
): Promise<ExternalBusyResult> {
  if (!isGoogleConfigured()) {
    return { busy: [], failed: [], complete: true };
  }

  let connections;
  try {
    connections = await conflictConnections(userId);
  } catch (error) {
    return {
      busy: [],
      failed: [{ accountEmail: "google", reason: String(error) }],
      complete: false,
    };
  }

  if (connections.length === 0) {
    return { busy: [], failed: [], complete: true };
  }

  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        const busy = await fetchFreeBusy(
          connection.accessToken,
          connection.calendarId,
          from,
          to,
        );
        return { busy, failure: null };
      } catch (error) {
        if (error instanceof GoogleAuthError) {
          await markConnectionBroken(connection.id, error.message);
        }
        return {
          busy: [] as Interval[],
          failure: {
            accountEmail: connection.accountEmail,
            reason: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }),
  );

  const failed = results
    .map((result) => result.failure)
    .filter((failure): failure is { accountEmail: string; reason: string } =>
      Boolean(failure),
    );

  return {
    busy: results.flatMap((result) => result.busy),
    failed,
    complete: failed.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Mirroring bookings out
// ---------------------------------------------------------------------------

type SyncableBooking = {
  id: string;
  uid: string;
  hostId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date;
  timeZone: string;
  status: string;
  locationType: Parameters<typeof describeLocation>[0];
  locationValue: string | null;
  meetingUrl: string | null;
  externalEventId: string | null;
  externalCalendarId: string | null;
  attendees: { name: string; email: string }[];
};

async function loadForSync(bookingId: string): Promise<SyncableBooking | null> {
  return db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      uid: true,
      hostId: true,
      title: true,
      description: true,
      startTime: true,
      endTime: true,
      timeZone: true,
      status: true,
      locationType: true,
      locationValue: true,
      meetingUrl: true,
      externalEventId: true,
      externalCalendarId: true,
      attendees: { select: { name: true, email: true } },
    },
  });
}

function eventBody(booking: SyncableBooking) {
  const where = describeLocation(
    booking.locationType,
    booking.locationValue,
    booking.meetingUrl,
  );
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const description = [
    booking.description,
    booking.meetingUrl ? `Join: ${booking.meetingUrl}` : null,
    `Manage this booking: ${appUrl}/booking/${booking.uid}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    summary: booking.title,
    description,
    location: where,
    start: booking.startTime,
    end: booking.endTime,
    timeZone: booking.timeZone,
    attendees: booking.attendees
      .filter((attendee) => attendee.email)
      .map((attendee) => ({
        email: attendee.email,
        displayName: attendee.name,
      })),
    requestId: booking.uid,
  };
}

/**
 * Pushes a booking into the host's destination calendar, creating or patching
 * as needed.
 *
 * Failures are recorded on the booking and swallowed. A booking that exists in
 * meetsnaply but not yet in Google is a recoverable inconsistency; throwing
 * here would either lose the booking or show the invitee an error for
 * something that already succeeded.
 */
export async function syncBookingToCalendar(bookingId: string): Promise<void> {
  if (!isGoogleConfigured()) return;

  const booking = await loadForSync(bookingId);
  if (!booking) return;

  // Only confirmed bookings belong on the host's real calendar. A PENDING
  // request still blocks the slot inside meetsnaply, but mirroring requests
  // the host hasn't accepted would fill their calendar with holds that may
  // never happen.
  if (booking.status !== "CONFIRMED") {
    await removeBookingFromCalendar(bookingId);
    return;
  }

  try {
    const connection = await destinationConnection(booking.hostId);
    if (!connection) return;

    const body = eventBody(booking);

    if (booking.externalEventId && booking.externalCalendarId) {
      await patchEvent(
        connection.accessToken,
        booking.externalCalendarId,
        booking.externalEventId,
        body,
      );
      await db.booking.update({
        where: { id: booking.id },
        data: { externalSyncError: null },
      });
      return;
    }

    const created = await insertEvent(
      connection.accessToken,
      connection.calendarId,
      body,
    );

    await db.booking.update({
      where: { id: booking.id },
      data: {
        externalEventId: created.id,
        externalCalendarId: connection.calendarId,
        externalConnectionId: connection.id,
        externalSyncError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.booking.update({
      where: { id: booking.id },
      data: { externalSyncError: message.slice(0, 500) },
    });
  }
}

/** Deletes the mirrored event. Also best-effort. */
export async function removeBookingFromCalendar(
  bookingId: string,
): Promise<void> {
  if (!isGoogleConfigured()) return;

  const booking = await loadForSync(bookingId);
  if (!booking?.externalEventId || !booking.externalCalendarId) return;

  try {
    const connection = await destinationConnection(booking.hostId);
    if (!connection) return;

    await deleteEvent(
      connection.accessToken,
      booking.externalCalendarId,
      booking.externalEventId,
    );

    await db.booking.update({
      where: { id: booking.id },
      data: {
        externalEventId: null,
        externalCalendarId: null,
        externalConnectionId: null,
        externalSyncError: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.booking.update({
      where: { id: booking.id },
      data: { externalSyncError: message.slice(0, 500) },
    });
  }
}
