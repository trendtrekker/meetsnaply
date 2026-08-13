import "server-only";
import { db } from "@/lib/db";
import { getExternalBusy } from "@/lib/calendar";
import {
  generateSlots,
  isSlotBookable,
  localDateKey,
  type EventTypeInput,
  type Interval,
  type ScheduleInput,
} from "./engine";

export * from "./engine";

const MINUTE = 60_000;

/** Statuses that occupy the host's calendar. */
const BLOCKING_STATUSES = ["PENDING", "CONFIRMED"] as const;

export type BookableEventType = NonNullable<
  Awaited<ReturnType<typeof getBookableEventType>>
>;

/** Loads an event type by public handle + slug, with everything booking needs. */
export async function getBookableEventType(username: string, slug: string) {
  return db.eventType.findFirst({
    where: {
      slug,
      isActive: true,
      user: { username },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
          bio: true,
          timeZone: true,
          brandColor: true,
        },
      },
      schedule: { include: { rules: true, overrides: true } },
      questions: { orderBy: { position: "asc" } },
    },
  });
}

function toEventTypeInput(eventType: {
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  maxBookingsPerDay: number | null;
}): EventTypeInput {
  return {
    durationMinutes: eventType.durationMinutes,
    slotIntervalMinutes: eventType.slotIntervalMinutes,
    bufferBeforeMinutes: eventType.bufferBeforeMinutes,
    bufferAfterMinutes: eventType.bufferAfterMinutes,
    minimumNoticeMinutes: eventType.minimumNoticeMinutes,
    bookingHorizonDays: eventType.bookingHorizonDays,
    maxBookingsPerDay: eventType.maxBookingsPerDay,
  };
}

/**
 * Falls back to the host's default schedule, then to a hard-coded weekday
 * 09:00–17:00, so an event type without a schedule is never silently
 * unbookable.
 */
async function resolveSchedule(
  eventType: {
    userId: string;
    schedule: {
      timeZone: string;
      rules: { weekday: number; startMinute: number; endMinute: number }[];
      overrides: {
        date: Date;
        isBlocked: boolean;
        startMinute: number | null;
        endMinute: number | null;
      }[];
    } | null;
  },
  hostTimeZone: string,
): Promise<ScheduleInput> {
  let source = eventType.schedule;

  if (!source) {
    source = await db.schedule.findFirst({
      where: { userId: eventType.userId, isDefault: true },
      include: { rules: true, overrides: true },
    });
  }

  if (!source) {
    return {
      timeZone: hostTimeZone,
      rules: [1, 2, 3, 4, 5].map((weekday) => ({
        weekday,
        startMinute: 9 * 60,
        endMinute: 17 * 60,
      })),
      overrides: [],
    };
  }

  return {
    timeZone: source.timeZone,
    rules: source.rules.map((r) => ({
      weekday: r.weekday,
      startMinute: r.startMinute,
      endMinute: r.endMinute,
    })),
    overrides: source.overrides.map((o) => ({
      // Stored as a DATE at UTC midnight; slice avoids a local-zone shift.
      date: o.date.toISOString().slice(0, 10),
      isBlocked: o.isBlocked,
      startMinute: o.startMinute,
      endMinute: o.endMinute,
    })),
  };
}

/**
 * Busy time for a host, with each existing booking widened by *its own* event
 * type's buffers.
 */
async function loadBusy(
  hostId: string,
  from: Date,
  to: Date,
  excludeBookingId?: string,
): Promise<{
  busy: Interval[];
  bookings: { start: Date }[];
  externalComplete: boolean;
  externalFailures: { accountEmail: string; reason: string }[];
}> {
  const bookings = await db.booking.findMany({
    where: {
      hostId,
      status: { in: [...BLOCKING_STATUSES] },
      // Widened by a day so a long meeting straddling the edge still counts.
      startTime: { lt: new Date(to.getTime() + 86_400_000) },
      endTime: { gt: new Date(from.getTime() - 86_400_000) },
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
    },
    select: {
      startTime: true,
      endTime: true,
      eventType: {
        select: { bufferBeforeMinutes: true, bufferAfterMinutes: true },
      },
    },
  });

  // Events on the host's own Google calendars block slots too. These carry no
  // meetsnaply buffers — a buffer is a property of our event types, and we
  // know nothing about the shape of an external meeting.
  const external = await getExternalBusy(hostId, from, to);

  return {
    busy: [
      ...bookings.map((b) => ({
        start: b.startTime.getTime() - b.eventType.bufferBeforeMinutes * MINUTE,
        end: b.endTime.getTime() + b.eventType.bufferAfterMinutes * MINUTE,
      })),
      ...external.busy,
    ],
    bookings: bookings.map((b) => ({ start: b.startTime })),
    externalComplete: external.complete,
    externalFailures: external.failed,
  };
}

export interface SlotsResult {
  slots: Date[];
  hostTimeZone: string;
  scheduleTimeZone: string;
  /**
   * False when a connected calendar could not be consulted, so the slot list
   * may show times that are actually busy. The write path re-checks and will
   * reject those, which is why displaying them is acceptable.
   */
  externalBusyComplete: boolean;
}

/** Every bookable start time for an event type inside `[from, to]`. */
export async function getAvailableSlots(options: {
  eventType: BookableEventType;
  from: Date;
  to: Date;
  now?: Date;
  excludeBookingId?: string;
}): Promise<SlotsResult> {
  const { eventType, from, to, now, excludeBookingId } = options;

  const schedule = await resolveSchedule(eventType, eventType.user.timeZone);
  const { busy, bookings, externalComplete } = await loadBusy(
    eventType.userId,
    from,
    to,
    excludeBookingId,
  );

  const bookingsPerDay: Record<string, number> = {};
  for (const booking of bookings) {
    const key = localDateKey(booking.start, schedule.timeZone);
    bookingsPerDay[key] = (bookingsPerDay[key] ?? 0) + 1;
  }

  const slots = generateSlots({
    eventType: toEventTypeInput(eventType),
    schedule,
    busy,
    from,
    to,
    now,
    bookingsPerDay,
  });

  return {
    slots,
    hostTimeZone: eventType.user.timeZone,
    scheduleTimeZone: schedule.timeZone,
    externalBusyComplete: externalComplete,
  };
}

/** Why a slot was refused, so the booking form can say something useful. */
export type SlotRejection = "taken" | "calendar-unreachable";

/**
 * Re-validates a single instant immediately before writing a booking.
 *
 * Unlike the display path, this fails closed: if a connected calendar can't be
 * reached we refuse rather than guess. Showing a stale slot costs the invitee
 * one extra click; writing a booking over a meeting we couldn't see costs the
 * host a real conflict they only discover when two people dial in.
 */
export async function verifySlot(options: {
  eventType: BookableEventType;
  start: Date;
  now?: Date;
  excludeBookingId?: string;
}): Promise<{ ok: true } | { ok: false; reason: SlotRejection }> {
  const { eventType, start, now, excludeBookingId } = options;

  const schedule = await resolveSchedule(eventType, eventType.user.timeZone);
  const windowStart = new Date(start.getTime() - 86_400_000);
  const windowEnd = new Date(start.getTime() + 86_400_000);
  const { busy, bookings, externalComplete } = await loadBusy(
    eventType.userId,
    windowStart,
    windowEnd,
    excludeBookingId,
  );

  if (!externalComplete) {
    return { ok: false, reason: "calendar-unreachable" };
  }

  const bookingsPerDay: Record<string, number> = {};
  for (const booking of bookings) {
    const key = localDateKey(booking.start, schedule.timeZone);
    bookingsPerDay[key] = (bookingsPerDay[key] ?? 0) + 1;
  }

  const bookable = isSlotBookable(
    {
      eventType: toEventTypeInput(eventType),
      schedule,
      busy,
      now,
      bookingsPerDay,
    },
    start,
  );

  return bookable ? { ok: true } : { ok: false, reason: "taken" };
}
