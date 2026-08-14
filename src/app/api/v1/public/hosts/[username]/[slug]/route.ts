import type { NextRequest } from "next/server";
import { notFound, ok } from "@/lib/api/respond";
import { getAvailableSlots, getBookableEventType } from "@/lib/availability";
import { monthKey, parseMonthKey } from "@/lib/datetime";

/**
 * A bookable event type and one month of slots.
 *
 * Slots come with the event type rather than from a second endpoint because
 * every client needs both to draw anything, and the month is the natural unit
 * the calendar paginates by. `?month=YYYY-MM` moves the window; omitting it
 * gives the current month in the *host's* timezone, matching the web page.
 *
 * The range is padded a day on each side so slots near a month boundary still
 * appear once the invitee's timezone shifts them across it.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string; slug: string }> },
) {
  const { username, slug } = await params;

  const eventType = await getBookableEventType(username, slug);
  if (!eventType) return notFound("That booking link is no longer available.");

  const now = new Date();
  const requested =
    request.nextUrl.searchParams.get("month") ??
    monthKey(now, eventType.user.timeZone);
  const { year, month } = parseMonthKey(requested, now);

  const from = new Date(Date.UTC(year, month, 1, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 1, 0, 0));

  const { slots, externalBusyComplete } = await getAvailableSlots({
    eventType,
    from: new Date(from.getTime() - 86_400_000),
    to: new Date(to.getTime() + 86_400_000),
    now,
  });

  return ok({
    eventType: {
      slug: eventType.slug,
      title: eventType.title,
      description: eventType.description,
      durationMinutes: eventType.durationMinutes,
      locationType: eventType.locationType,
      recordingEnabled: eventType.recordingEnabled,
      transcriptionEnabled: eventType.transcriptionEnabled,
      sendRecapToAttendees: eventType.sendRecapToAttendees,
      requiresConfirmation: eventType.requiresConfirmation,
      questions: eventType.questions,
      host: {
        name: eventType.user.name,
        username: eventType.user.username,
        avatarUrl: eventType.user.avatarUrl,
        timeZone: eventType.user.timeZone,
        brandColor: eventType.user.brandColor,
      },
    },
    month: requested,
    slots,
    /**
     * False when a connected calendar could not be consulted, so some of these
     * times may already be taken. Booking re-checks and will refuse them, which
     * is why showing them is acceptable — but the client should say so.
     */
    externalBusyComplete,
  });
}
