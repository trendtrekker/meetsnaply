import { TZDate } from "@date-fns/tz";

/**
 * Slot generation. Pure and side-effect free — everything it needs is passed
 * in, so it can be unit tested without a database.
 *
 * The core idea: availability rules are authored in the *host's* timezone
 * ("Mondays 09:00–17:00 Europe/Berlin"), so they are expanded per host-local
 * calendar day into absolute UTC instants. Only after that is anything
 * compared, subtracted, or filtered. The invitee's timezone never enters this
 * file — it is purely a presentation concern for grouping and labelling.
 */

/** Half-open interval of epoch milliseconds: [start, end). */
export interface Interval {
  start: number;
  end: number;
}

export interface WeeklyRule {
  /** 0 = Sunday … 6 = Saturday, matching Date#getDay(). */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface Override {
  /** Host-local calendar date as "YYYY-MM-DD". */
  date: string;
  isBlocked: boolean;
  startMinute?: number | null;
  endMinute?: number | null;
}

export interface ScheduleInput {
  timeZone: string;
  rules: WeeklyRule[];
  overrides: Override[];
}

export interface EventTypeInput {
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  maxBookingsPerDay?: number | null;
}

export interface SlotQuery {
  eventType: EventTypeInput;
  schedule: ScheduleInput;
  /** Already-taken time, buffers of the *existing* bookings included. */
  busy: Interval[];
  /** Window to search, in UTC. */
  from: Date;
  to: Date;
  now?: Date;
  /** Host-local "YYYY-MM-DD" → bookings already on that day. */
  bookingsPerDay?: Record<string, number>;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" for the given instant as seen in `timeZone`. */
export function localDateKey(instant: Date | number, timeZone: string): string {
  const d = new TZDate(
    typeof instant === "number" ? instant : instant.getTime(),
    timeZone,
  );
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Absolute instant for a wall-clock time on a local date.
 * `minutes` may exceed 1440 (an 00:00 end-of-day rolls into the next date).
 */
export function zonedInstant(
  dateKey: string,
  minutes: number,
  timeZone: string,
): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new TZDate(y, m - 1, d, hours, mins, 0, 0, timeZone).getTime();
}

/** Weekday (0–6) of a local date key, timezone independent. */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Interval algebra
// ---------------------------------------------------------------------------

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);

  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** True when `candidate` overlaps any interval in `blocks` (half-open). */
export function overlapsAny(candidate: Interval, blocks: Interval[]): boolean {
  return blocks.some(
    (block) => candidate.start < block.end && block.start < candidate.end,
  );
}

// ---------------------------------------------------------------------------
// Working windows
// ---------------------------------------------------------------------------

/**
 * Expands weekly rules and date overrides into absolute UTC intervals covering
 * `[from, to]`. An override replaces every weekly rule for that date.
 */
export function expandWorkingWindows(
  schedule: ScheduleInput,
  from: Date,
  to: Date,
): Interval[] {
  const { timeZone, rules } = schedule;
  const overrides = new Map(schedule.overrides.map((o) => [o.date, o]));

  // Pad a day on each side: a host-local day can start before `from` in UTC.
  let key = localDateKey(from.getTime() - DAY, timeZone);
  const lastKey = localDateKey(to.getTime() + DAY, timeZone);

  const windows: Interval[] = [];
  // Hard stop so a malformed range can never spin forever.
  for (let guard = 0; guard < 800; guard++) {
    const override = overrides.get(key);

    if (override) {
      if (
        !override.isBlocked &&
        override.startMinute != null &&
        override.endMinute != null &&
        override.endMinute > override.startMinute
      ) {
        windows.push({
          start: zonedInstant(key, override.startMinute, timeZone),
          end: zonedInstant(key, override.endMinute, timeZone),
        });
      }
      // isBlocked → contribute nothing for this date.
    } else {
      const weekday = weekdayOf(key);
      for (const rule of rules) {
        if (rule.weekday !== weekday) continue;
        if (rule.endMinute <= rule.startMinute) continue;
        windows.push({
          start: zonedInstant(key, rule.startMinute, timeZone),
          end: zonedInstant(key, rule.endMinute, timeZone),
        });
      }
    }

    if (key === lastKey) break;
    key = addDaysToKey(key, 1);
  }

  // Keep windows that intersect the range, but do NOT clip their bounds: the
  // slot grid is anchored to window.start, so trimming a window to the range
  // edge would shift every start time on that day.
  const rangeStart = from.getTime();
  const rangeEnd = to.getTime();
  return mergeIntervals(
    windows.filter((w) => w.end > rangeStart && w.start < rangeEnd),
  );
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/** Earliest and latest start an invitee is allowed to book right now. */
export function bookableWindow(eventType: EventTypeInput, now = new Date()) {
  return {
    earliest: new Date(now.getTime() + eventType.minimumNoticeMinutes * MINUTE),
    latest: new Date(now.getTime() + eventType.bookingHorizonDays * DAY),
  };
}

/**
 * Every start time an invitee can book, as UTC instants, ascending.
 *
 * A candidate survives when the meeting *plus its buffers* fits inside one
 * continuous working window and touches nothing already booked.
 */
export function generateSlots(query: SlotQuery): Date[] {
  const { eventType, schedule, busy, from, to } = query;
  const now = query.now ?? new Date();

  const duration = eventType.durationMinutes * MINUTE;
  const step = Math.max(1, eventType.slotIntervalMinutes) * MINUTE;
  const bufferBefore = eventType.bufferBeforeMinutes * MINUTE;
  const bufferAfter = eventType.bufferAfterMinutes * MINUTE;

  const { earliest, latest } = bookableWindow(eventType, now);
  const searchFrom = new Date(Math.max(from.getTime(), earliest.getTime()));
  const searchTo = new Date(Math.min(to.getTime(), latest.getTime()));
  if (searchTo <= searchFrom) return [];

  // Widen the expansion window by the buffers so a slot near a boundary is
  // still evaluated against the whole working window it belongs to.
  const windows = expandWorkingWindows(
    schedule,
    new Date(from.getTime() - bufferBefore),
    new Date(to.getTime() + bufferAfter),
  );

  const blocked = mergeIntervals(busy);
  const dayCounts = query.bookingsPerDay ?? {};
  const maxPerDay = eventType.maxBookingsPerDay ?? null;

  const slots: Date[] = [];

  // The grid is anchored to the *working window*, not to the gaps between
  // existing bookings. Anchoring to the gaps would re-align the whole day
  // around a conflict and offer times like 16:15 next to 14:00 and 14:30.
  for (const window of windows) {
    for (let start = window.start; ; start += step) {
      const end = start + duration;

      // The meeting and both buffers must fit inside this single window.
      if (end + bufferAfter > window.end) break;
      if (start > searchTo.getTime()) break;
      if (start - bufferBefore < window.start) continue;
      if (start < searchFrom.getTime()) continue;

      if (overlapsAny({ start: start - bufferBefore, end: end + bufferAfter }, blocked)) {
        continue;
      }

      if (maxPerDay != null) {
        const dayKey = localDateKey(start, schedule.timeZone);
        if ((dayCounts[dayKey] ?? 0) >= maxPerDay) continue;
      }

      slots.push(new Date(start));
    }
  }

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/**
 * Authoritative re-check used at booking time. Slot lists are generated for a
 * whole month and can be seconds stale by the time someone clicks, so the
 * write path validates the one instant it is about to persist.
 */
export function isSlotBookable(
  query: Omit<SlotQuery, "from" | "to">,
  start: Date,
): boolean {
  const target = start.getTime();
  // Search a full day either side rather than a tight window around the
  // target: the working window the slot belongs to has to be expanded in one
  // piece for the grid to line up, and a window can run for hours.
  const slots = generateSlots({
    ...query,
    from: new Date(target - DAY),
    to: new Date(target + DAY),
  });
  return slots.some((slot) => slot.getTime() === target);
}
