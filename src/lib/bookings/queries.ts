import "server-only";
import { db } from "@/lib/db";
import type { BookingStatus } from "@/generated/prisma/enums";

/**
 * Read paths for bookings, shared by the dashboard pages and `/api/v1`.
 *
 * The tab definitions in particular are worth having in one place: "past"
 * meaning *confirmed or pending, already ended* rather than simply "before now"
 * is a decision, and a native app that quietly disagreed with the web app about
 * which meetings are past would be a bug nobody could see.
 */

export const BOOKING_TABS = [
  "upcoming",
  "unconfirmed",
  "past",
  "cancelled",
] as const;

export type BookingTab = (typeof BOOKING_TABS)[number];

export function isBookingTab(value: unknown): value is BookingTab {
  return BOOKING_TABS.includes(value as BookingTab);
}

export function bookingFilter(tab: BookingTab, userId: string, now: Date) {
  const base = { hostId: userId };
  switch (tab) {
    case "unconfirmed":
      return { ...base, status: "PENDING" as BookingStatus };
    case "past":
      return {
        ...base,
        status: { in: ["CONFIRMED", "PENDING"] as BookingStatus[] },
        endTime: { lt: now },
      };
    case "cancelled":
      return {
        ...base,
        status: { in: ["CANCELLED", "REJECTED"] as BookingStatus[] },
      };
    default:
      return {
        ...base,
        status: "CONFIRMED" as BookingStatus,
        endTime: { gte: now },
      };
  }
}

/** One tab's worth of bookings, newest-relevant first. */
export async function listBookings(
  userId: string,
  tab: BookingTab,
  now = new Date(),
  take = 50,
) {
  return db.booking.findMany({
    where: bookingFilter(tab, userId, now),
    orderBy: { startTime: tab === "past" ? "desc" : "asc" },
    take,
    include: {
      eventType: { select: { title: true, transcriptionEnabled: true } },
      attendees: { orderBy: { isGuest: "asc" } },
      recap: { select: { id: true, sentAt: true } },
    },
  });
}

/** How many requests are waiting on the host — the badge on the dashboard. */
export function countUnconfirmed(userId: string, now = new Date()) {
  return db.booking.count({ where: bookingFilter("unconfirmed", userId, now) });
}

/** A booking the caller hosts, with everything the detail view shows. */
export async function getHostBooking(userId: string, uid: string) {
  return db.booking.findFirst({
    where: { uid, hostId: userId },
    include: {
      eventType: {
        select: {
          title: true,
          slug: true,
          durationMinutes: true,
          transcriptionEnabled: true,
          recordingEnabled: true,
        },
      },
      attendees: { orderBy: { isGuest: "asc" } },
      answers: true,
      recap: true,
      recording: {
        select: { id: true, status: true, roomName: true, externalId: true },
      },
    },
  });
}

/**
 * A booking by its public uid, for the confirmation screen.
 *
 * The uid is the capability: anyone holding it may see the booking, which is
 * how the emailed link works. So this returns only what that page shows and
 * never widens to host-only fields.
 */
export async function getPublicBooking(uid: string) {
  return db.booking.findUnique({
    where: { uid },
    select: {
      uid: true,
      title: true,
      status: true,
      startTime: true,
      endTime: true,
      timeZone: true,
      meetingUrl: true,
      locationType: true,
      locationValue: true,
      cancelReason: true,
      host: { select: { name: true, username: true, timeZone: true } },
      eventType: { select: { title: true, slug: true, durationMinutes: true } },
      attendees: {
        orderBy: { isGuest: "asc" },
        select: { name: true, email: true, isGuest: true },
      },
    },
  });
}
