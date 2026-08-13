"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getBookableEventType, verifySlot } from "@/lib/availability";
import { getCurrentUser } from "@/lib/auth";
import {
  removeBookingFromCalendar,
  syncBookingToCalendar,
} from "@/lib/calendar";
import { isDailyConfigured, provisionRoom, releaseRoom } from "@/lib/video";
import { enqueue } from "@/lib/jobs/queue";
import {
  cancelPendingReminders,
  scheduleBookingNotifications,
  scheduleReminders,
} from "./notifications";

export interface BookingFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const emailList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().email("One of the guest emails is invalid")).max(10));

const bookingSchema = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1),
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  guests: emailList,
  consentRecording: z.string().optional(),
  rescheduleOf: z.string().optional(),
});

/** Postgres exclusion-constraint violation from the overlap backstop. */
function isOverlapViolation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Booking_host_no_overlap") || message.includes("23P01")
  );
}

export async function createBooking(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const parsed = bookingSchema.safeParse({
    username: formData.get("username"),
    slug: formData.get("slug"),
    start: formData.get("start"),
    timeZone: formData.get("timeZone"),
    name: formData.get("name"),
    email: formData.get("email"),
    guests: formData.get("guests") ?? "",
    consentRecording: formData.get("consentRecording") ?? undefined,
    rescheduleOf: formData.get("rescheduleOf") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const input = parsed.data;
  const eventType = await getBookableEventType(input.username, input.slug);
  if (!eventType) {
    return { error: "That booking link is no longer available." };
  }

  const start = new Date(input.start);
  const end = new Date(
    start.getTime() + eventType.durationMinutes * 60_000,
  );

  // Recording consent is required before we may capture anything.
  const wantsRecording =
    eventType.recordingEnabled || eventType.transcriptionEnabled;
  if (wantsRecording && input.consentRecording !== "on") {
    return {
      fieldErrors: {
        consentRecording:
          "This meeting is recorded and transcribed. Please accept to continue.",
      },
    };
  }

  // Answers to the host's custom questions.
  const answers: { questionId: string; label: string; value: string }[] = [];
  for (const question of eventType.questions) {
    const raw = formData.getAll(`q_${question.identifier}`);
    const value = raw
      .map((v) => String(v).trim())
      .filter(Boolean)
      .join(", ");

    if (question.required && !value) {
      return { fieldErrors: { [`q_${question.identifier}`]: "Required" } };
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

  revalidatePath("/dashboard");
  redirect(`/booking/${uid}`);
}

export async function cancelBooking(formData: FormData) {
  const uid = String(formData.get("uid") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!uid) return;

  const booking = await db.booking.findUnique({
    where: { uid },
    select: {
      id: true,
      status: true,
      recording: { select: { roomName: true } },
    },
  });
  if (!booking || booking.status === "CANCELLED") return;

  await db.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: reason || null,
    },
  });

  await removeBookingFromCalendar(booking.id);
  await releaseRoom(booking.recording?.roomName);
  await cancelPendingReminders(booking.id);

  // This action is only reachable from the public booking page, so the invitee
  // is always the one cancelling.
  await enqueue({
    type: "booking.cancelled",
    payload: { bookingId: booking.id, actor: "invitee" },
    dedupeKey: `booking-cancelled:${booking.id}`,
  });

  revalidatePath("/dashboard");
  redirect(`/booking/${uid}`);
}

/** Host-side confirmation for event types that require approval. */
export async function setBookingStatus(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const uid = String(formData.get("uid") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!uid || !["CONFIRMED", "REJECTED", "CANCELLED"].includes(status)) return;

  const booking = await db.booking.findFirst({
    where: { uid, hostId: user.id },
    select: { id: true },
  });
  if (!booking) return;

  await db.booking.update({
    where: { id: booking.id },
    data: {
      status: status as "CONFIRMED" | "REJECTED" | "CANCELLED",
      ...(status === "CONFIRMED" ? {} : { cancelledAt: new Date() }),
    },
  });

  // Approving a pending request is when it first belongs on the calendar;
  // declining or cancelling takes it back off.
  if (status === "CONFIRMED") {
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

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/bookings/${uid}`);
}
