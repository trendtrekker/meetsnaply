import "server-only";
import { refreshPath } from "@/lib/cache";
import { db } from "@/lib/db";
import { getBookableEventType, verifySlot } from "@/lib/availability";
import {
  removeBookingFromCalendar,
  syncBookingToCalendar,
} from "@/lib/calendar";
import { isDailyConfigured, provisionRoom, releaseRoom } from "@/lib/video";
import { enqueue } from "@/lib/jobs/queue";
import type {
  BookSlotInput,
  CancelBookingInput,
  SetBookingStatusInput,
} from "@/lib/api/contracts";
import {
  cancelPendingReminders,
  scheduleBookingNotifications,
  scheduleReminders,
} from "./notifications";

/**
 * Booking as an operation, with no opinion about how it was requested.
 *
 * The web form action and the `/api/v1` route handlers both call these, so a
 * booking made on a phone goes through exactly the same consent gate, slot
 * re-check, overlap backstop, and notification scheduling as one made in a
 * browser. Callers own only two things: turning their transport into the input
 * shape, and deciding what to do with the result — redirect, or serialise.
 *
 * `refreshPath` lives in here rather than in the callers so that a write from
 * any surface refreshes the dashboard. Forgetting it in one caller would leave
 * a booking invisible until the next hard reload.
 */

export type BookSlotResult =
  | { ok: true; uid: string }
  | { ok: false; error?: string; fieldErrors?: Record<string, string> };

/** Postgres exclusion-constraint violation from the overlap backstop. */
function isOverlapViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Booking_host_no_overlap") || message.includes("23P01")
  );
}

/**
 * Field errors for questions keep the web form's `q_<identifier>` key, because
 * that is what the rendered inputs are named. Native clients strip the prefix.
 */
function questionErrorKey(identifier: string) {
  return `q_${identifier}`;
}

export async function bookSlot(
  input: BookSlotInput,
): Promise<BookSlotResult> {
  const eventType = await getBookableEventType(input.username, input.slug);
  if (!eventType) {
    return { ok: false, error: "That booking link is no longer available." };
  }

  const start = new Date(input.start);
  const end = new Date(start.getTime() + eventType.durationMinutes * 60_000);

  // Recording consent is required before we may capture anything.
  const wantsRecording =
    eventType.recordingEnabled || eventType.transcriptionEnabled;
  if (wantsRecording && !input.consentRecording) {
    return {
      ok: false,
      fieldErrors: {
        consentRecording:
          "This meeting is recorded and transcribed. Please accept to continue.",
      },
    };
  }

  // Answers to the host's custom questions.
  const answers: { questionId: string; label: string; value: string }[] = [];
  for (const question of eventType.questions) {
    const raw = input.answers[question.identifier];
    const value = (Array.isArray(raw) ? raw : raw == null ? [] : [raw])
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(", ");

    if (question.required && !value) {
      return {
        ok: false,
        fieldErrors: { [questionErrorKey(question.identifier)]: "Required" },
      };
    }
    if (value) {
      answers.push({ questionId: question.id, label: question.label, value });
    }
  }

  // `rescheduleOf` is a public uid; the availability layer excludes by primary
  // key. Resolve it here or the booking being replaced blocks its own
  // replacement, making any overlapping reschedule impossible.
  const previous = input.rescheduleOf
    ? await db.booking.findFirst({
        where: { uid: input.rescheduleOf, hostId: eventType.userId },
        select: {
          id: true,
          startTime: true,
          calendarUid: true,
          calendarSequence: true,
        },
      })
    : null;

  // Slot lists are generated per month and go stale; re-check this one instant.
  const verified = await verifySlot({
    eventType,
    start,
    excludeBookingId: previous?.id,
  });
  if (!verified.ok) {
    return {
      ok: false,
      error:
        verified.reason === "calendar-unreachable"
          ? "We couldn't reach the host's calendar to confirm this time is free. Please try again in a moment."
          : "That time was taken while you were filling this in. Pick another slot.",
    };
  }

  let uid: string;
  let bookingId: string;
  try {
    const booking = await db.$transaction(async (tx) => {
      if (previous) {
        await tx.booking.update({
          where: { id: previous.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: "Rescheduled by the invitee",
          },
        });
      }

      const created = await tx.booking.create({
        data: {
          eventTypeId: eventType.id,
          hostId: eventType.userId,
          title: `${eventType.title} between ${eventType.user.name} and ${input.name}`,
          description: eventType.description,
          startTime: start,
          endTime: end,
          timeZone: input.timeZone,
          status: eventType.requiresConfirmation ? "PENDING" : "CONFIRMED",
          locationType: eventType.locationType,
          locationValue: eventType.locationValue,
          rescheduledFromId: previous?.id ?? null,
          // A reschedule keeps the calendar event's identity and bumps its
          // sequence, so recipients' calendars move the existing entry instead
          // of holding a dead one beside a new one.
          ...(previous
            ? {
                calendarUid: previous.calendarUid,
                calendarSequence: previous.calendarSequence + 1,
              }
            : {}),
          // The host is not an attendee row — `hostId` already records them.
          attendees: {
            create: [
              {
                name: input.name,
                email: input.email,
                timeZone: input.timeZone,
                status: "ACCEPTED",
                recordingConsentAt: wantsRecording ? new Date() : null,
              },
              ...input.guests.map((guestEmail) => ({
                name: guestEmail,
                email: guestEmail,
                timeZone: input.timeZone,
                isGuest: true,
              })),
            ],
          },
          answers: { create: answers },
        },
        select: { id: true, uid: true },
      });

      if (eventType.recordingEnabled) {
        await tx.meetingRecording.create({
          data: {
            bookingId: created.id,
            provider: isDailyConfigured() ? "daily" : "meetsnaply",
          },
        });
      }

      return created;
    });

    uid = booking.uid;
    bookingId = booking.id;
  } catch (error) {
    if (isOverlapViolation(error)) {
      return {
        ok: false,
        error:
          "Someone booked that slot a moment before you. Pick another time.",
      };
    }
    throw error;
  }

  // Everything below is outside the transaction on purpose: a third-party outage
  // must not roll back a booking that is already valid. Each step records its own
  // failures rather than throwing.

  // The room has to exist before the calendar event is written, or the invite
  // would carry no join link.
  const room = await provisionRoom({
    locationType: eventType.locationType,
    bookingUid: uid,
    startTime: start,
    endTime: end,
    record: eventType.recordingEnabled,
  });

  if (room) {
    await db.booking.update({
      where: { id: bookingId },
      data: { meetingUrl: room.url },
    });
    if (eventType.recordingEnabled) {
      await db.meetingRecording.updateMany({
        where: { bookingId },
        data: {
          roomName: room.roomName,
          // No room name means no provider recording will ever arrive, so don't
          // leave the row claiming one is on its way.
          status: room.roomName ? "SCHEDULED" : "FAILED",
        },
      });
    }
  }

  if (previous) {
    await removeBookingFromCalendar(previous.id);
    // The replaced booking is cancelled; nobody should still be reminded of it.
    await cancelPendingReminders(previous.id);
  }
  await syncBookingToCalendar(bookingId);

  // Queued, not sent inline: the invitee shouldn't wait on an email provider,
  // and a provider outage must not fail a booking that already exists.
  //
  // A move gets one "your meeting is now X" email rather than a cancellation
  // followed by an unrelated confirmation — two emails that would describe the
  // same change without referring to each other.
  if (previous) {
    await enqueue({
      type: "booking.rescheduled",
      // The public booking page is the invitee's; a host moving a meeting goes
      // through the dashboard, which passes its own actor.
      payload: { bookingId, actor: "invitee" },
      dedupeKey: `booking-rescheduled:${bookingId}`,
    });
  } else {
    await scheduleBookingNotifications(bookingId);
  }

  if (previous) {
    await scheduleReminders(bookingId);
  }

  refreshPath("/dashboard");
  return { ok: true, uid };
}

/** Invitee-initiated cancellation. Idempotent: an already-cancelled booking is a no-op. */
export async function cancelBookingByUid(
  input: CancelBookingInput,
): Promise<{ ok: boolean }> {
  const booking = await db.booking.findUnique({
    where: { uid: input.uid },
    select: {
      id: true,
      status: true,
      recording: { select: { roomName: true } },
    },
  });
  if (!booking || booking.status === "CANCELLED") return { ok: false };

  await db.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: input.reason || null,
    },
  });

  await removeBookingFromCalendar(booking.id);
  await releaseRoom(booking.recording?.roomName);
  await cancelPendingReminders(booking.id);

  // This path is only reachable from the public booking page and its native
  // equivalent, so the invitee is always the one cancelling.
  await enqueue({
    type: "booking.cancelled",
    payload: { bookingId: booking.id, actor: "invitee" },
    dedupeKey: `booking-cancelled:${booking.id}`,
  });

  refreshPath("/dashboard");
  return { ok: true };
}

/** Host-side approval, rejection, or cancellation. Scoped to the host's own bookings. */
export async function setBookingStatusForHost(
  hostId: string,
  input: SetBookingStatusInput,
): Promise<{ ok: boolean }> {
  const booking = await db.booking.findFirst({
    where: { uid: input.uid, hostId },
    select: { id: true },
  });
  if (!booking) return { ok: false };

  await db.booking.update({
    where: { id: booking.id },
    data: {
      status: input.status,
      ...(input.status === "CONFIRMED" ? {} : { cancelledAt: new Date() }),
    },
  });

  // Approving a pending request is when it first belongs on the calendar;
  // declining or cancelling takes it back off.
  if (input.status === "CONFIRMED") {
    await syncBookingToCalendar(booking.id);
    // Approval is also when the invitee gets a real confirmation and an .ics —
    // the request-received email deliberately carried neither.
    await enqueue({
      type: "booking.confirmation",
      payload: { bookingId: booking.id },
      dedupeKey: `booking-confirmation:approved:${booking.id}`,
    });
    await scheduleReminders(booking.id);
  } else {
    await removeBookingFromCalendar(booking.id);
    await cancelPendingReminders(booking.id);
    // Declining a request and cancelling a confirmed meeting are the same news
    // to the invitee: it isn't happening, and here's why.
    await enqueue({
      type: "booking.cancelled",
      payload: { bookingId: booking.id, actor: "host" },
      dedupeKey: `booking-cancelled:${booking.id}`,
    });
  }

  refreshPath("/dashboard");
  refreshPath(`/dashboard/bookings/${input.uid}`);
  return { ok: true };
}
