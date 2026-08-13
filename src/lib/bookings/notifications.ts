import "server-only";
import { db } from "@/lib/db";
import { enqueue } from "@/lib/jobs/queue";
import { JobSkipped, PermanentJobError } from "@/lib/jobs/errors";
import { sendEmail, type EmailAttachment } from "@/lib/email/send";
import { buildCalendarInvite } from "@/lib/email/ics";
import {
  cancellationEmail,
  confirmationEmail,
  hostNotificationEmail,
  reminderEmail,
  requestReceivedEmail,
  rescheduledEmail,
  type BookingEmailData,
  type CancellationActor,
} from "@/lib/email/templates/booking";
import { describeLocation } from "./locations";

/**
 * Booking lifecycle notifications: confirmation, host alert, and reminders.
 *
 * Sending is queued rather than inline. A booking must not fail because an email
 * provider is having a bad minute, and the invitee should not wait on an SMTP
 * round trip before seeing their confirmation page.
 */

function origin() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Everything both the templates and the .ics need, loaded once. */
async function loadBooking(bookingId: string) {
  return db.booking.findUnique({
    where: { id: bookingId },
    include: {
      host: { select: { name: true, email: true, timeZone: true, username: true } },
      eventType: {
        select: {
          title: true,
          slug: true,
          durationMinutes: true,
          recordingEnabled: true,
          transcriptionEnabled: true,
          requiresConfirmation: true,
          reminderMinutes: true,
        },
      },
      attendees: true,
      answers: { select: { label: true, value: true } },
      // The time this booking moved from, for the "was / now" line.
      rescheduledFrom: { select: { startTime: true } },
      // Present when this booking was itself superseded by a later move.
      rescheduledTo: { select: { id: true } },
    },
  });
}

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

function baseEmailData(
  booking: LoadedBooking,
  recipient: { name: string; timeZone: string },
): BookingEmailData {
  const invitee = booking.attendees.find((attendee) => !attendee.isGuest);
  const durationMinutes = Math.round(
    (booking.endTime.getTime() - booking.startTime.getTime()) / 60_000,
  );

  return {
    recipientName: recipient.name,
    timeZone: recipient.timeZone || booking.timeZone,
    hostName: booking.host.name,
    inviteeName: invitee?.name ?? "your invitee",
    meetingTitle: booking.eventType.title,
    description: booking.description,
    startTime: booking.startTime,
    durationMinutes,
    location: describeLocation(
      booking.locationType,
      booking.locationValue,
      booking.meetingUrl,
    ),
    meetingUrl: booking.meetingUrl,
    answers: booking.answers,
    manageUrl: `${origin()}/booking/${booking.uid}`,
    rescheduleUrl: `${origin()}/${booking.host.username}/${booking.eventType.slug}?reschedule=${booking.uid}`,
    recorded:
      booking.eventType.recordingEnabled ||
      booking.eventType.transcriptionEnabled,
  };
}

function calendarAttachment(
  booking: LoadedBooking,
  method: "REQUEST" | "CANCEL",
): EmailAttachment {
  const ics = buildCalendarInvite({
    // The calendar event's identity, not the booking row's: a rescheduled
    // booking carries its predecessor's value, so recipients see one event that
    // moved, and a later CANCEL still matches what is in their calendar.
    uid: `${booking.calendarUid}@meetsnaply`,
    method,
    // A cancellation must outrank the invitation it revokes, or clients ignore
    // it. The reschedule path bumps this on the booking itself.
    sequence:
      method === "CANCEL"
        ? booking.calendarSequence + 1
        : booking.calendarSequence,
    title: booking.eventType.title,
    description: booking.description,
    location: describeLocation(
      booking.locationType,
      booking.locationValue,
      booking.meetingUrl,
    ),
    url: booking.meetingUrl,
    start: booking.startTime,
    end: booking.endTime,
    organizer: { name: booking.host.name, email: booking.host.email },
    attendees: [
      { name: booking.host.name, email: booking.host.email, isOrganizer: true },
      ...booking.attendees
        .filter((attendee) => attendee.email)
        .map((attendee) => ({ name: attendee.name, email: attendee.email })),
    ],
  });

  return {
    filename: method === "CANCEL" ? "cancel.ics" : "invite.ics",
    content: ics,
    // METHOD in the Content-Type is what makes clients act on the file —
    // showing accept/decline, or removing the event — rather than treating it
    // as a plain download. It must match the METHOD inside the body.
    contentType: `text/calendar; charset=utf-8; method=${method}`,
  };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Queues the confirmation plus every future reminder for a booking.
 *
 * Reminders are scheduled at booking time rather than polled for, so the queue
 * holds one row per reminder and the worker never has to scan the calendar.
 */
export async function scheduleBookingNotifications(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      startTime: true,
      status: true,
      eventType: { select: { reminderMinutes: true } },
    },
  });
  if (!booking) return;

  await enqueue({
    type: "booking.confirmation",
    payload: { bookingId: booking.id },
    dedupeKey: `booking-confirmation:${booking.id}`,
  });

  // A pending request holds no time, so reminding anyone about it would be
  // premature — they get scheduled when the host approves.
  if (booking.status !== "CONFIRMED") return;

  await scheduleReminders(booking.id);
}

export async function scheduleReminders(bookingId: string) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      startTime: true,
      eventType: { select: { reminderMinutes: true } },
    },
  });
  if (!booking) return;

  const now = Date.now();

  for (const minutesBefore of booking.eventType.reminderMinutes) {
    const sendAt = booking.startTime.getTime() - minutesBefore * 60_000;

    // Skip a window that has already passed — booking 30 minutes out must not
    // fire a "tomorrow" reminder immediately.
    if (sendAt <= now) continue;

    await enqueue({
      type: "booking.reminder",
      payload: { bookingId: booking.id, minutesBefore },
      dedupeKey: `booking-reminder:${booking.id}:${minutesBefore}`,
      delayMs: sendAt - now,
      // A reminder is worthless once its moment passes; don't retry for hours.
      maxAttempts: 3,
    });
  }
}

/**
 * Drops reminders that have not fired yet.
 *
 * Called on cancel, decline, and reschedule. Without this, someone who cancelled
 * a meeting still gets told it starts in an hour — the single worst failure this
 * feature can have.
 */
export async function cancelPendingReminders(bookingId: string) {
  await db.job.deleteMany({
    where: {
      type: "booking.reminder",
      status: "PENDING",
      payload: { path: ["bookingId"], equals: bookingId },
    },
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function sendBookingConfirmation(bookingId: string) {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    throw new PermanentJobError(`Booking ${bookingId} no longer exists`);
  }
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    throw new JobSkipped("Booking was cancelled before confirmation was sent");
  }

  const pending = booking.status === "PENDING";
  const invitee = booking.attendees.find(
    (attendee) => !attendee.isGuest && attendee.email,
  );

  let sent = 0;

  // Invitee and guests. A pending request gets no .ics — see the template note.
  const recipients = booking.attendees.filter((attendee) => attendee.email);
  for (const attendee of recipients) {
    const data = baseEmailData(booking, {
      name: attendee.name,
      timeZone: attendee.timeZone,
    });
    const rendered = pending
      ? requestReceivedEmail(data)
      : confirmationEmail(data);

    const result = await sendEmail({
      to: attendee.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      replyTo: booking.host.email,
      ...(pending ? {} : { attachments: [calendarAttachment(booking, "REQUEST")] }),
    });
    if (result.delivered) sent++;
  }

  // Host.
  const hostData = hostNotificationEmail({
    ...baseEmailData(booking, {
      name: booking.host.name,
      timeZone: booking.host.timeZone,
    }),
    needsApproval: pending,
  });

  const hostResult = await sendEmail({
    to: booking.host.email,
    subject: hostData.subject,
    html: hostData.html,
    text: hostData.text,
    ...(invitee ? { replyTo: invitee.email } : {}),
    ...(pending ? {} : { attachments: [calendarAttachment(booking, "REQUEST")] }),
  });
  if (hostResult.delivered) sent++;

  return sent === 0
    ? `Confirmation not sent (email unconfigured); ${recipients.length + 1} recipient(s) skipped`
    : `Confirmation sent to ${sent} recipient(s)${pending ? " (pending approval)" : ""}`;
}

/**
 * Tells everyone a meeting is off, and removes it from their calendars.
 *
 * Runs against a booking that is already CANCELLED — unlike the reminder, this
 * must *not* bail on status, because cancelled is precisely the state it exists
 * to announce.
 */
export async function sendCancellationNotice(
  bookingId: string,
  actor: CancellationActor,
) {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    throw new PermanentJobError(`Booking ${bookingId} no longer exists`);
  }
  if (booking.status !== "CANCELLED" && booking.status !== "REJECTED") {
    throw new JobSkipped(
      `Booking is ${booking.status.toLowerCase()}; nothing to announce`,
    );
  }
  // A reschedule cancels the old booking as an implementation detail. Sending a
  // cancellation for it would contradict the "moved" email covering the same
  // change, so the reschedule notice speaks for both.
  if (booking.rescheduledTo) {
    throw new JobSkipped("Superseded by a reschedule; the move email covers it");
  }

  const attachment = calendarAttachment(booking, "CANCEL");
  const bookAgainUrl = `${origin()}/${booking.host.username}/${booking.eventType.slug}`;

  const recipients = [
    ...booking.attendees
      .filter((attendee) => attendee.email)
      .map((attendee) => ({
        email: attendee.email,
        name: attendee.name,
        timeZone: attendee.timeZone,
        isHost: false,
      })),
    {
      email: booking.host.email,
      name: booking.host.name,
      timeZone: booking.host.timeZone,
      isHost: true,
    },
  ];

  let sent = 0;
  for (const recipient of recipients) {
    const rendered = cancellationEmail({
      ...baseEmailData(booking, recipient),
      actor,
      reason: booking.cancelReason,
      // "You cancelled" for the person who did it, "X cancelled" for everyone
      // else — the same email would otherwise read as an accusation.
      toActor: actor === "host" ? recipient.isHost : !recipient.isHost,
      bookAgainUrl,
    });

    const result = await sendEmail({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: [attachment],
    });
    if (result.delivered) sent++;
  }

  // Persist the bump so a later reissue can't reuse a sequence a client has
  // already seen.
  await db.booking.update({
    where: { id: booking.id },
    data: { calendarSequence: booking.calendarSequence + 1 },
  });

  return sent === 0
    ? `Cancellation not sent (email unconfigured); ${recipients.length} recipient(s) skipped`
    : `Cancellation sent to ${sent} recipient(s)`;
}

/** Announces a new time, carrying the updated invitation. */
export async function sendRescheduleNotice(
  bookingId: string,
  actor: CancellationActor,
) {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    throw new PermanentJobError(`Booking ${bookingId} no longer exists`);
  }
  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    throw new JobSkipped("Booking was cancelled before the move was announced");
  }
  if (!booking.rescheduledFrom) {
    throw new PermanentJobError("Booking is not a reschedule of anything");
  }

  const attachment = calendarAttachment(booking, "REQUEST");
  const previousStartTime = booking.rescheduledFrom.startTime;

  const recipients = [
    ...booking.attendees
      .filter((attendee) => attendee.email)
      .map((attendee) => ({
        email: attendee.email,
        name: attendee.name,
        timeZone: attendee.timeZone,
        isHost: false,
      })),
    {
      email: booking.host.email,
      name: booking.host.name,
      timeZone: booking.host.timeZone,
      isHost: true,
    },
  ];

  let sent = 0;
  for (const recipient of recipients) {
    const rendered = rescheduledEmail({
      ...baseEmailData(booking, recipient),
      previousStartTime,
      actor,
      toActor: actor === "host" ? recipient.isHost : !recipient.isHost,
    });

    const result = await sendEmail({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      attachments: [attachment],
    });
    if (result.delivered) sent++;
  }

  return sent === 0
    ? `Reschedule notice not sent (email unconfigured); ${recipients.length} recipient(s) skipped`
    : `Reschedule notice sent to ${sent} recipient(s)`;
}

export async function sendBookingReminder(
  bookingId: string,
  minutesBefore: number,
) {
  const booking = await loadBooking(bookingId);
  if (!booking) {
    throw new PermanentJobError(`Booking ${bookingId} no longer exists`);
  }

  // Re-checked at send time, not just at schedule time: a booking can be
  // cancelled between the two, and cancelPendingReminders can lose a race with
  // a worker that has already claimed this job.
  if (booking.status !== "CONFIRMED") {
    throw new JobSkipped(
      `Booking is ${booking.status.toLowerCase()}; no reminder sent`,
    );
  }
  if (booking.startTime.getTime() < Date.now()) {
    throw new JobSkipped("Meeting already started; reminder is moot");
  }

  let sent = 0;
  const recipients = [
    ...booking.attendees
      .filter((attendee) => attendee.email)
      .map((attendee) => ({
        email: attendee.email,
        name: attendee.name,
        timeZone: attendee.timeZone,
      })),
    {
      email: booking.host.email,
      name: booking.host.name,
      timeZone: booking.host.timeZone,
    },
  ];

  for (const recipient of recipients) {
    const rendered = reminderEmail({
      ...baseEmailData(booking, recipient),
      minutesBefore,
    });
    const result = await sendEmail({
      to: recipient.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (result.delivered) sent++;
  }

  return sent === 0
    ? `Reminder not sent (email unconfigured); ${recipients.length} recipient(s) skipped`
    : `Reminder sent to ${sent} recipient(s)`;
}
