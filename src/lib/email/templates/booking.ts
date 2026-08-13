import "server-only";
import { formatDateTime, zoneAbbreviation } from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";
import {
  button,
  detailList,
  footnote,
  header,
  linkRow,
  paragraph,
  shell,
} from "./layout";

/**
 * Booking lifecycle emails: confirmation, request-received, host notification,
 * and reminders.
 *
 * Every one renders in the *recipient's* timezone, not the booking's. An invitee
 * in New York and a host in Berlin must each read their own local time from the
 * same meeting, which is the whole reason the app tracks a zone per attendee.
 */

export interface BookingEmailData {
  recipientName: string;
  /** The zone this particular recipient reads times in. */
  timeZone: string;
  hostName: string;
  inviteeName: string;
  meetingTitle: string;
  description: string | null;
  startTime: Date;
  durationMinutes: number;
  location: string;
  meetingUrl: string | null;
  /** Answers to the host's custom questions, shown to the host. */
  answers: { label: string; value: string }[];
  manageUrl: string;
  rescheduleUrl: string;
  recorded: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function whenLine(data: BookingEmailData) {
  return `${formatDateTime(data.startTime, data.timeZone)} (${zoneAbbreviation(
    data.startTime,
    data.timeZone,
  )})`;
}

function coreDetails(data: BookingEmailData) {
  return [
    { label: "When", value: whenLine(data) },
    { label: "Duration", value: formatDuration(data.durationMinutes) },
    { label: "Where", value: data.meetingUrl ?? data.location },
    { label: "Who", value: `${data.hostName} and ${data.inviteeName}` },
  ];
}

function detailsText(data: BookingEmailData) {
  return [
    `When: ${whenLine(data)}`,
    `Duration: ${formatDuration(data.durationMinutes)}`,
    `Where: ${data.meetingUrl ?? data.location}`,
    `Who: ${data.hostName} and ${data.inviteeName}`,
  ];
}

const RECORDING_NOTE =
  "This meeting is recorded and transcribed. Everyone on the call gets the summary and transcript by email afterwards.";

// ---------------------------------------------------------------------------
// Invitee — booking confirmed
// ---------------------------------------------------------------------------

export function confirmationEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Confirmed: ${data.meetingTitle} with ${data.hostName}`;

  const text = [
    `Your meeting with ${data.hostName} is confirmed.`,
    "",
    ...detailsText(data),
    "",
    data.description ?? "",
    data.recorded ? `\n${RECORDING_NOTE}` : "",
    "",
    `Reschedule: ${data.rescheduleUrl}`,
    `Cancel or view: ${data.manageUrl}`,
    "",
    "The calendar invitation is attached.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = shell({
    // Lead the inbox preview with the time — the one fact worth seeing unopened.
    preheader: `${formatDateTime(data.startTime, data.timeZone)} with ${data.hostName}`,
    rows: [
      header({
        title: "You're booked",
        subtitle: `${data.meetingTitle} with ${data.hostName}`,
      }),
      detailList(coreDetails(data)),
      data.description ? paragraph(data.description) : "",
      data.meetingUrl ? button(data.meetingUrl, "Join the meeting") : "",
      linkRow([
        { url: data.rescheduleUrl, label: "Reschedule" },
        { url: data.manageUrl, label: "Cancel" },
      ]),
      footnote(
        data.recorded
          ? `${RECORDING_NOTE} The calendar invitation is attached to this email.`
          : "The calendar invitation is attached to this email.",
      ),
    ].join(""),
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Invitee — request awaiting host approval
// ---------------------------------------------------------------------------

export function requestReceivedEmail(data: BookingEmailData): RenderedEmail {
  const subject = `Requested: ${data.meetingTitle} with ${data.hostName}`;

  const text = [
    `Your request is with ${data.hostName}. Nothing is confirmed yet — you'll get another email either way.`,
    "",
    ...detailsText(data),
    "",
    `View or withdraw: ${data.manageUrl}`,
  ].join("\n");

  const html = shell({
    preheader: `Waiting on ${data.hostName} to confirm`,
    rows: [
      header({
        title: "Request sent",
        subtitle: `${data.meetingTitle} with ${data.hostName}`,
      }),
      paragraph(
        `${data.hostName} still needs to approve this time. You'll get another email either way, and nothing is held in your calendar until then.`,
      ),
      detailList(coreDetails(data)),
      linkRow([{ url: data.manageUrl, label: "View or withdraw the request" }]),
      // No .ics here on purpose: attaching one would put an event in the
      // invitee's calendar for a meeting that may never be approved.
      footnote(
        "You'll receive a calendar invitation once the request is confirmed.",
      ),
    ].join(""),
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Host — somebody booked
// ---------------------------------------------------------------------------

export function hostNotificationEmail(
  data: BookingEmailData & { needsApproval: boolean },
): RenderedEmail {
  const subject = data.needsApproval
    ? `Approve: ${data.inviteeName} requested ${data.meetingTitle}`
    : `New booking: ${data.inviteeName} — ${data.meetingTitle}`;

  const text = [
    data.needsApproval
      ? `${data.inviteeName} requested a time. It is not held until you confirm.`
      : `${data.inviteeName} booked a time with you.`,
    "",
    ...detailsText(data),
    "",
    ...(data.answers.length > 0
      ? ["What they said:", ...data.answers.map((a) => `${a.label}: ${a.value}`), ""]
      : []),
    `Open the booking: ${data.manageUrl}`,
  ].join("\n");

  const html = shell({
    preheader: `${data.inviteeName} · ${formatDateTime(data.startTime, data.timeZone)}`,
    rows: [
      header({
        title: data.needsApproval ? "Booking request" : "New booking",
        subtitle: `${data.inviteeName} · ${data.meetingTitle}`,
      }),
      detailList(coreDetails(data)),
      ...(data.answers.length > 0
        ? [detailList(data.answers.map((a) => ({ label: a.label, value: a.value })))]
        : []),
      button(
        data.manageUrl,
        data.needsApproval ? "Review the request" : "Open the booking",
      ),
      footnote(
        data.needsApproval
          ? "This time is held as pending until you confirm or decline it."
          : "The calendar invitation is attached to this email.",
      ),
    ].join(""),
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/** Who ended the meeting — changes the wording, not the facts. */
export type CancellationActor = "host" | "invitee";

export interface CancellationEmailData extends BookingEmailData {
  actor: CancellationActor;
  reason: string | null;
  /** True when this email goes to the person who did the cancelling. */
  toActor: boolean;
  bookAgainUrl: string;
}

export function cancellationEmail(data: CancellationEmailData): RenderedEmail {
  const actorName = data.actor === "host" ? data.hostName : data.inviteeName;
  const subject = `Cancelled: ${data.meetingTitle} — ${formatDateTime(
    data.startTime,
    data.timeZone,
  )}`;

  // Telling someone "you cancelled" reads as an accusation when they didn't,
  // and as noise when they did — so the sentence names the actor either way.
  const opener = data.toActor
    ? `You cancelled this meeting. ${data.actor === "host" ? data.inviteeName : data.hostName} has been told.`
    : `${actorName} cancelled this meeting.`;

  const text = [
    opener,
    "",
    `Was: ${whenLine(data)}`,
    `Meeting: ${data.meetingTitle}`,
    ...(data.reason ? ["", `Reason: ${data.reason}`] : []),
    "",
    `Book another time: ${data.bookAgainUrl}`,
    "",
    "It has been removed from your calendar.",
  ].join("\n");

  const html = shell({
    preheader: `${data.meetingTitle} on ${formatDateTime(data.startTime, data.timeZone)} is off`,
    rows: [
      header({ title: "Meeting cancelled", subtitle: data.meetingTitle }),
      paragraph(opener),
      detailList([
        { label: "Was", value: whenLine(data) },
        { label: "Duration", value: formatDuration(data.durationMinutes) },
        ...(data.reason ? [{ label: "Reason", value: data.reason }] : []),
      ]),
      button(data.bookAgainUrl, "Book another time"),
      footnote(
        "This meeting has been removed from your calendar. Nothing else is needed from you.",
      ),
    ].join(""),
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

export interface RescheduleEmailData extends BookingEmailData {
  previousStartTime: Date;
  actor: CancellationActor;
  toActor: boolean;
}

export function rescheduledEmail(data: RescheduleEmailData): RenderedEmail {
  const actorName = data.actor === "host" ? data.hostName : data.inviteeName;
  const subject = `Moved: ${data.meetingTitle} is now ${formatDateTime(
    data.startTime,
    data.timeZone,
  )}`;

  const opener = data.toActor
    ? "You moved this meeting. Everyone else has been told."
    : `${actorName} moved this meeting.`;

  const text = [
    opener,
    "",
    `Was: ${formatDateTime(data.previousStartTime, data.timeZone)}`,
    `Now: ${whenLine(data)}`,
    `Duration: ${formatDuration(data.durationMinutes)}`,
    `Where: ${data.meetingUrl ?? data.location}`,
    "",
    ...(data.meetingUrl ? [`Join: ${data.meetingUrl}`, ""] : []),
    `Reschedule again: ${data.rescheduleUrl}`,
    `Cancel: ${data.manageUrl}`,
    "",
    "Your calendar has been updated — the old time is gone.",
  ].join("\n");

  const html = shell({
    preheader: `Now ${formatDateTime(data.startTime, data.timeZone)}`,
    rows: [
      header({ title: "New time", subtitle: data.meetingTitle }),
      paragraph(opener),
      detailList([
        // Old first, then new: the reader's question is "what changed", and the
        // answer only makes sense in that order.
        {
          label: "Was",
          value: formatDateTime(data.previousStartTime, data.timeZone),
        },
        { label: "Now", value: whenLine(data) },
        { label: "Duration", value: formatDuration(data.durationMinutes) },
        { label: "Where", value: data.meetingUrl ?? data.location },
      ]),
      data.meetingUrl ? button(data.meetingUrl, "Join the meeting") : "",
      linkRow([
        { url: data.rescheduleUrl, label: "Reschedule again" },
        { url: data.manageUrl, label: "Cancel" },
      ]),
      footnote(
        "The updated calendar invitation is attached — accepting it replaces the old time.",
      ),
    ].join(""),
  });

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Reminder
// ---------------------------------------------------------------------------

/** "in 24 hours" / "in 1 hour" / "in 15 minutes". */
export function describeLeadTime(minutesBefore: number): string {
  if (minutesBefore % 1440 === 0) {
    const days = minutesBefore / 1440;
    return days === 1 ? "tomorrow" : `in ${days} days`;
  }
  if (minutesBefore % 60 === 0) {
    const hours = minutesBefore / 60;
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `in ${minutesBefore} minutes`;
}

export function reminderEmail(
  data: BookingEmailData & { minutesBefore: number },
): RenderedEmail {
  const lead = describeLeadTime(data.minutesBefore);
  const subject = `Reminder: ${data.meetingTitle} ${lead}`;

  const text = [
    `${data.meetingTitle} starts ${lead}.`,
    "",
    ...detailsText(data),
    "",
    ...(data.meetingUrl ? [`Join: ${data.meetingUrl}`, ""] : []),
    `Reschedule: ${data.rescheduleUrl}`,
    `Cancel: ${data.manageUrl}`,
  ].join("\n");

  const html = shell({
    preheader: `Starts ${lead} — ${formatDateTime(data.startTime, data.timeZone)}`,
    rows: [
      header({
        title: `Starting ${lead}`,
        subtitle: `${data.meetingTitle} with ${data.hostName}`,
      }),
      detailList(coreDetails(data)),
      data.meetingUrl ? button(data.meetingUrl, "Join the meeting") : "",
      linkRow([
        { url: data.rescheduleUrl, label: "Reschedule" },
        { url: data.manageUrl, label: "Cancel" },
      ]),
      data.recorded ? footnote(RECORDING_NOTE) : "",
    ].join(""),
  });

  return { subject, html, text };
}
