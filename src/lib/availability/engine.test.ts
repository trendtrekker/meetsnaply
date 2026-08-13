import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bookableWindow,
  expandWorkingWindows,
  generateSlots,
  isSlotBookable,
  localDateKey,
  mergeIntervals,
  overlapsAny,
  zonedInstant,
  type EventTypeInput,
  type Interval,
  type ScheduleInput,
  type SlotQuery,
} from "./engine";

/**
 * The engine is pure, so everything here is fixture in / instants out. Dates
 * are written as UTC ISO strings and asserted as UTC ISO strings — the host's
 * wall clock is noted in comments where it matters, because that is what the
 * rules are authored in.
 *
 * Reference dates: 2026-06-10 is a Wednesday in CEST (UTC+2), 2026-01-14 a
 * Wednesday in CET (UTC+1). Berlin springs forward 2026-03-29 and falls back
 * 2026-10-25.
 */

const BERLIN = "Europe/Berlin";

function at(iso: string): Date {
  return new Date(iso);
}

function isoOf(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

function eventType(patch: Partial<EventTypeInput> = {}): EventTypeInput {
  return {
    durationMinutes: 30,
    slotIntervalMinutes: 30,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 0,
    bookingHorizonDays: 365,
    maxBookingsPerDay: null,
    ...patch,
  };
}

/** Weekdays 09:00–17:00 in the host's timezone. */
function schedule(patch: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    timeZone: BERLIN,
    rules: [1, 2, 3, 4, 5].map((weekday) => ({
      weekday,
      startMinute: 9 * 60,
      endMinute: 17 * 60,
    })),
    overrides: [],
    ...patch,
  };
}

/** A query over Wednesday 2026-06-10, well inside notice and horizon. */
function query(patch: Partial<SlotQuery> = {}): SlotQuery {
  return {
    eventType: eventType(),
    schedule: schedule(),
    busy: [],
    from: at("2026-06-10T00:00:00Z"),
    to: at("2026-06-11T00:00:00Z"),
    now: at("2026-06-01T00:00:00Z"),
    ...patch,
  };
}

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

describe("localDateKey", () => {
  it("reports the calendar date as seen in the given zone", () => {
    // 23:30 UTC is already the next day in Berlin and Tokyo, still today in NY.
    const instant = at("2026-06-10T23:30:00Z");
    assert.equal(localDateKey(instant, BERLIN), "2026-06-11");
    assert.equal(localDateKey(instant, "Asia/Tokyo"), "2026-06-11");
    assert.equal(localDateKey(instant, "America/New_York"), "2026-06-10");
    assert.equal(localDateKey(instant, "UTC"), "2026-06-10");
  });

  it("accepts an epoch number as well as a Date", () => {
    const instant = at("2026-06-10T23:30:00Z");
    assert.equal(
      localDateKey(instant.getTime(), BERLIN),
      localDateKey(instant, BERLIN),
    );
  });

  it("zero-pads single-digit months and days", () => {
    assert.equal(localDateKey(at("2026-01-05T12:00:00Z"), BERLIN), "2026-01-05");
  });
});

describe("zonedInstant", () => {
  it("resolves a wall-clock time against the zone's offset", () => {
    // Summer: UTC+2. Winter: UTC+1. Same 09:00 rule, different instants.
    assert.equal(
      new Date(zonedInstant("2026-06-10", 9 * 60, BERLIN)).toISOString(),
      "2026-06-10T07:00:00.000Z",
    );
    assert.equal(
      new Date(zonedInstant("2026-01-14", 9 * 60, BERLIN)).toISOString(),
      "2026-01-14T08:00:00.000Z",
    );
  });

  it("rolls minutes past midnight into the next local date", () => {
    // 24:00 on the 10th is 00:00 on the 11th, i.e. 22:00 UTC on the 10th.
    assert.equal(
      new Date(zonedInstant("2026-06-10", 24 * 60, BERLIN)).toISOString(),
      "2026-06-10T22:00:00.000Z",
    );
    assert.equal(
      new Date(zonedInstant("2026-06-10", 25 * 60 + 30, BERLIN)).toISOString(),
      "2026-06-10T23:30:00.000Z",
    );
  });

  it("handles minutes that are not whole hours", () => {
    assert.equal(
      new Date(zonedInstant("2026-06-10", 9 * 60 + 45, BERLIN)).toISOString(),
      "2026-06-10T07:45:00.000Z",
    );
  });

  // These two pin behaviour rather than assert a requirement: a wall-clock time
  // in the DST seam has no single right answer, and both resolutions below are
  // reasonable. They are here so an upgrade of @date-fns/tz that changes the
  // convention fails loudly instead of quietly moving a night-shift host's
  // working window by an hour.
  it("shifts a wall-clock time the spring-forward jump skips", () => {
    // 02:30 never happens on 2026-03-29; it resolves to 03:30 local.
    assert.equal(
      new Date(zonedInstant("2026-03-29", 2 * 60 + 30, BERLIN)).toISOString(),
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("takes the second pass of a wall-clock time the fall-back repeats", () => {
    // 02:30 happens twice on 2026-10-25; it resolves to the later, CET one.
    assert.equal(
      new Date(zonedInstant("2026-10-25", 2 * 60 + 30, BERLIN)).toISOString(),
      "2026-10-25T01:30:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Interval algebra
// ---------------------------------------------------------------------------

describe("mergeIntervals", () => {
  it("sorts and merges overlapping intervals", () => {
    const merged = mergeIntervals([
      { start: 30, end: 50 },
      { start: 0, end: 40 },
      { start: 100, end: 110 },
    ]);
    assert.deepEqual(merged, [
      { start: 0, end: 50 },
      { start: 100, end: 110 },
    ]);
  });

  it("merges intervals that only touch", () => {
    assert.deepEqual(
      mergeIntervals([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
      [{ start: 0, end: 20 }],
    );
  });

  it("absorbs a fully contained interval without shrinking the outer one", () => {
    assert.deepEqual(
      mergeIntervals([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
      ]),
      [{ start: 0, end: 100 }],
    );
  });

  it("drops empty and inverted intervals", () => {
    assert.deepEqual(
      mergeIntervals([
        { start: 5, end: 5 },
        { start: 20, end: 10 },
      ]),
      [],
    );
  });

  it("does not mutate its input", () => {
    const input: Interval[] = [
      { start: 30, end: 50 },
      { start: 0, end: 40 },
    ];
    const snapshot = structuredClone(input);
    mergeIntervals(input);
    assert.deepEqual(input, snapshot);
  });

  it("returns an empty array for no input", () => {
    assert.deepEqual(mergeIntervals([]), []);
  });
});

describe("overlapsAny", () => {
  const blocks: Interval[] = [{ start: 100, end: 200 }];

  it("treats intervals as half-open, so touching is not overlapping", () => {
    assert.equal(overlapsAny({ start: 50, end: 100 }, blocks), false);
    assert.equal(overlapsAny({ start: 200, end: 250 }, blocks), false);
  });

  it("detects partial overlap at either end", () => {
    assert.equal(overlapsAny({ start: 50, end: 101 }, blocks), true);
    assert.equal(overlapsAny({ start: 199, end: 250 }, blocks), true);
  });

  it("detects containment in both directions", () => {
    assert.equal(overlapsAny({ start: 120, end: 130 }, blocks), true);
    assert.equal(overlapsAny({ start: 0, end: 500 }, blocks), true);
  });

  it("is false against no blocks", () => {
    assert.equal(overlapsAny({ start: 0, end: 500 }, []), false);
  });
});

// ---------------------------------------------------------------------------
// Working windows
// ---------------------------------------------------------------------------

describe("expandWorkingWindows", () => {
  it("expands a weekly rule into the host's local wall clock", () => {
    const windows = expandWorkingWindows(
      schedule(),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    // Wednesday 09:00–17:00 CEST.
    assert.equal(windows.length, 1);
    assert.equal(
      new Date(windows[0].start).toISOString(),
      "2026-06-10T07:00:00.000Z",
    );
    assert.equal(
      new Date(windows[0].end).toISOString(),
      "2026-06-10T15:00:00.000Z",
    );
  });

  it("keeps the same wall clock across a DST change", () => {
    const summer = expandWorkingWindows(
      schedule(),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    const winter = expandWorkingWindows(
      schedule(),
      at("2026-01-14T00:00:00Z"),
      at("2026-01-15T00:00:00Z"),
    );
    assert.equal(
      new Date(summer[0].start).toISOString(),
      "2026-06-10T07:00:00.000Z",
    );
    assert.equal(
      new Date(winter[0].start).toISOString(),
      "2026-01-14T08:00:00.000Z",
    );
  });

  it("emits one window per rule and merges adjacent ones", () => {
    const split = expandWorkingWindows(
      schedule({
        rules: [
          { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
          { weekday: 3, startMinute: 13 * 60, endMinute: 17 * 60 },
        ],
      }),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.equal(split.length, 2);

    const touching = expandWorkingWindows(
      schedule({
        rules: [
          { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
          { weekday: 3, startMinute: 12 * 60, endMinute: 17 * 60 },
        ],
      }),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.equal(touching.length, 1);
  });

  it("skips rules whose end is at or before their start", () => {
    const windows = expandWorkingWindows(
      schedule({
        rules: [
          { weekday: 3, startMinute: 17 * 60, endMinute: 9 * 60 },
          { weekday: 3, startMinute: 10 * 60, endMinute: 10 * 60 },
        ],
      }),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.deepEqual(windows, []);
  });

  it("lets an override replace every weekly rule for that date", () => {
    const windows = expandWorkingWindows(
      schedule({
        overrides: [
          {
            date: "2026-06-10",
            isBlocked: false,
            startMinute: 13 * 60,
            endMinute: 15 * 60,
          },
        ],
      }),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.equal(windows.length, 1);
    assert.equal(
      new Date(windows[0].start).toISOString(),
      "2026-06-10T11:00:00.000Z",
    );
    assert.equal(
      new Date(windows[0].end).toISOString(),
      "2026-06-10T13:00:00.000Z",
    );
  });

  it("lets an override open a day the weekly rules leave closed", () => {
    // Saturday 2026-06-13 has no weekly rule.
    const windows = expandWorkingWindows(
      schedule({
        overrides: [
          {
            date: "2026-06-13",
            isBlocked: false,
            startMinute: 10 * 60,
            endMinute: 12 * 60,
          },
        ],
      }),
      at("2026-06-13T00:00:00Z"),
      at("2026-06-14T00:00:00Z"),
    );
    assert.equal(windows.length, 1);
    assert.equal(
      new Date(windows[0].start).toISOString(),
      "2026-06-13T08:00:00.000Z",
    );
  });

  it("contributes nothing for a blocked override, even with hours set", () => {
    const windows = expandWorkingWindows(
      schedule({
        overrides: [
          {
            date: "2026-06-10",
            isBlocked: true,
            startMinute: 13 * 60,
            endMinute: 15 * 60,
          },
        ],
      }),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.deepEqual(windows, []);
  });

  it("closes the day when an unblocked override has no usable hours", () => {
    for (const patch of [
      { startMinute: null, endMinute: null },
      { startMinute: 15 * 60, endMinute: 13 * 60 },
    ]) {
      const windows = expandWorkingWindows(
        schedule({
          overrides: [{ date: "2026-06-10", isBlocked: false, ...patch }],
        }),
        at("2026-06-10T00:00:00Z"),
        at("2026-06-11T00:00:00Z"),
      );
      assert.deepEqual(windows, []);
    }
  });

  it("returns windows unclipped, so the slot grid stays anchored", () => {
    // Range covers only the middle of the working day.
    const windows = expandWorkingWindows(
      schedule(),
      at("2026-06-10T10:00:00Z"),
      at("2026-06-10T11:00:00Z"),
    );
    assert.equal(
      new Date(windows[0].start).toISOString(),
      "2026-06-10T07:00:00.000Z",
    );
    assert.equal(
      new Date(windows[0].end).toISOString(),
      "2026-06-10T15:00:00.000Z",
    );
  });

  it("drops windows that fall entirely outside the range", () => {
    // Tuesday's window ends before this range starts; Thursday's begins after.
    const windows = expandWorkingWindows(
      schedule(),
      at("2026-06-10T00:00:00Z"),
      at("2026-06-11T00:00:00Z"),
    );
    assert.equal(windows.length, 1);
  });

  it("covers a multi-day range", () => {
    const windows = expandWorkingWindows(
      schedule(),
      at("2026-06-08T00:00:00Z"), // Monday
      at("2026-06-13T00:00:00Z"), // Saturday
    );
    assert.equal(windows.length, 5);
  });
});

// ---------------------------------------------------------------------------
// Bookable window
// ---------------------------------------------------------------------------

describe("bookableWindow", () => {
  it("offsets now by the minimum notice and the booking horizon", () => {
    const { earliest, latest } = bookableWindow(
      eventType({ minimumNoticeMinutes: 120, bookingHorizonDays: 30 }),
      at("2026-06-10T09:00:00Z"),
    );
    assert.equal(earliest.toISOString(), "2026-06-10T11:00:00.000Z");
    assert.equal(latest.toISOString(), "2026-07-10T09:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

describe("generateSlots", () => {
  it("lays a grid anchored to the start of the working window", () => {
    const slots = generateSlots(query());
    assert.equal(slots.length, 16); // 07:00–15:00 UTC, 30-minute steps
    assert.equal(slots[0].toISOString(), "2026-06-10T07:00:00.000Z");
    assert.equal(slots.at(-1)!.toISOString(), "2026-06-10T14:30:00.000Z");
  });

  it("steps by the slot interval, not the duration", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ durationMinutes: 60, slotIntervalMinutes: 15 }),
      }),
    );
    assert.deepEqual(isoOf(slots).slice(0, 3), [
      "2026-06-10T07:00:00.000Z",
      "2026-06-10T07:15:00.000Z",
      "2026-06-10T07:30:00.000Z",
    ]);
    // Last 60-minute meeting must still end by 17:00 local (15:00 UTC).
    assert.equal(slots.at(-1)!.toISOString(), "2026-06-10T14:00:00.000Z");
  });

  it("requires the whole meeting to fit inside one window", () => {
    // 09:00–12:00 and 13:00–17:00: a 90-minute meeting cannot straddle lunch.
    const slots = generateSlots(
      query({
        eventType: eventType({ durationMinutes: 90, slotIntervalMinutes: 60 }),
        schedule: schedule({
          rules: [
            { weekday: 3, startMinute: 9 * 60, endMinute: 12 * 60 },
            { weekday: 3, startMinute: 13 * 60, endMinute: 17 * 60 },
          ],
        }),
      }),
    );
    assert.deepEqual(isoOf(slots), [
      "2026-06-10T07:00:00.000Z", // 09:00 local, ends 10:30
      "2026-06-10T08:00:00.000Z", // 10:00 local, ends 11:30
      // 11:00 local would run to 12:30, past the morning window — absent.
      "2026-06-10T11:00:00.000Z", // 13:00 local
      "2026-06-10T12:00:00.000Z", // 14:00 local
      "2026-06-10T13:00:00.000Z", // 15:00 local, ends 16:30
    ]);
  });

  it("returns nothing when the duration exceeds the window", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ durationMinutes: 600, slotIntervalMinutes: 60 }),
      }),
    );
    assert.deepEqual(slots, []);
  });

  it("keeps both buffers inside the working window", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
        }),
      }),
    );
    // 07:00 is out: its 15-minute lead-in starts before the window opens.
    // 14:30 is out: its 15-minute tail runs past 17:00 local.
    assert.equal(slots[0].toISOString(), "2026-06-10T07:30:00.000Z");
    assert.equal(slots.at(-1)!.toISOString(), "2026-06-10T14:00:00.000Z");
    assert.equal(slots.length, 14);
  });

  it("removes slots that collide with busy time", () => {
    const slots = generateSlots(
      query({
        busy: [
          {
            start: at("2026-06-10T09:00:00Z").getTime(),
            end: at("2026-06-10T09:30:00Z").getTime(),
          },
        ],
      }),
    );
    assert.equal(slots.length, 15);
    assert.ok(!isoOf(slots).includes("2026-06-10T09:00:00.000Z"));
    // Half-open: the slots abutting the busy block survive.
    assert.ok(isoOf(slots).includes("2026-06-10T08:30:00.000Z"));
    assert.ok(isoOf(slots).includes("2026-06-10T09:30:00.000Z"));
  });

  it("widens busy collisions by the event's own buffers", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({
          bufferBeforeMinutes: 15,
          bufferAfterMinutes: 15,
        }),
        busy: [
          {
            start: at("2026-06-10T09:00:00Z").getTime(),
            end: at("2026-06-10T09:30:00Z").getTime(),
          },
        ],
      }),
    );
    const times = isoOf(slots);
    assert.ok(!times.includes("2026-06-10T09:00:00.000Z"));
    // 08:30 ends at 09:00, but its 15-minute tail reaches into the block.
    assert.ok(!times.includes("2026-06-10T08:30:00.000Z"));
    // 09:30's 15-minute lead-in reaches back into the block.
    assert.ok(!times.includes("2026-06-10T09:30:00.000Z"));
    assert.ok(times.includes("2026-06-10T08:00:00.000Z"));
    assert.ok(times.includes("2026-06-10T10:00:00.000Z"));
  });

  it("does not re-anchor the grid around a conflict", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ durationMinutes: 60, slotIntervalMinutes: 60 }),
        busy: [
          {
            start: at("2026-06-10T08:00:00Z").getTime(),
            end: at("2026-06-10T08:30:00Z").getTime(),
          },
        ],
      }),
    );
    // The 10:00-local hour is gone; the rest stay on the hour rather than
    // shifting to 10:30, 11:30, …
    assert.deepEqual(isoOf(slots), [
      "2026-06-10T07:00:00.000Z",
      "2026-06-10T09:00:00.000Z",
      "2026-06-10T10:00:00.000Z",
      "2026-06-10T11:00:00.000Z",
      "2026-06-10T12:00:00.000Z",
      "2026-06-10T13:00:00.000Z",
      "2026-06-10T14:00:00.000Z",
    ]);
  });

  it("merges overlapping busy blocks before filtering", () => {
    const slots = generateSlots(
      query({
        busy: [
          {
            start: at("2026-06-10T09:00:00Z").getTime(),
            end: at("2026-06-10T10:00:00Z").getTime(),
          },
          {
            start: at("2026-06-10T09:30:00Z").getTime(),
            end: at("2026-06-10T11:00:00Z").getTime(),
          },
        ],
      }),
    );
    const times = isoOf(slots);
    for (const gone of ["09:00", "09:30", "10:00", "10:30"]) {
      assert.ok(!times.includes(`2026-06-10T${gone}:00.000Z`), gone);
    }
    assert.ok(times.includes("2026-06-10T11:00:00.000Z"));
  });

  it("honours the minimum notice", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ minimumNoticeMinutes: 60 }),
        now: at("2026-06-10T08:10:00Z"),
      }),
    );
    // Earliest bookable instant is 09:10; the next grid slot is 09:30.
    assert.equal(slots[0].toISOString(), "2026-06-10T09:30:00.000Z");
  });

  it("honours the booking horizon", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ bookingHorizonDays: 2 }),
        from: at("2026-06-08T00:00:00Z"), // Monday
        to: at("2026-06-12T00:00:00Z"), // Friday
        now: at("2026-06-08T00:00:00Z"),
      }),
    );
    // Monday and Tuesday only — Wednesday opens past the two-day horizon.
    assert.equal(slots.length, 32);
    assert.equal(slots.at(-1)!.toISOString(), "2026-06-09T14:30:00.000Z");
  });

  it("returns nothing when the horizon closes before the range opens", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({ bookingHorizonDays: 1 }),
        now: at("2026-06-01T00:00:00Z"),
      }),
    );
    assert.deepEqual(slots, []);
  });

  it("returns nothing for an inverted or empty range", () => {
    assert.deepEqual(
      generateSlots(
        query({
          from: at("2026-06-11T00:00:00Z"),
          to: at("2026-06-10T00:00:00Z"),
        }),
      ),
      [],
    );
    assert.deepEqual(
      generateSlots(
        query({
          from: at("2026-06-10T00:00:00Z"),
          to: at("2026-06-10T00:00:00Z"),
        }),
      ),
      [],
    );
  });

  it("stops offering a day once it hits the per-day cap", () => {
    const capped = generateSlots(
      query({
        eventType: eventType({ maxBookingsPerDay: 2 }),
        bookingsPerDay: { "2026-06-10": 2 },
      }),
    );
    assert.deepEqual(capped, []);

    const underCap = generateSlots(
      query({
        eventType: eventType({ maxBookingsPerDay: 2 }),
        bookingsPerDay: { "2026-06-10": 1 },
      }),
    );
    assert.equal(underCap.length, 16);
  });

  it("counts the cap per host-local day, not per UTC day", () => {
    // A late-evening window: 22:00–23:59 Berlin is the *next* UTC day.
    const slots = generateSlots(
      query({
        eventType: eventType({ maxBookingsPerDay: 1 }),
        schedule: schedule({
          rules: [{ weekday: 3, startMinute: 22 * 60, endMinute: 24 * 60 }],
        }),
        bookingsPerDay: { "2026-06-10": 1 },
        from: at("2026-06-10T00:00:00Z"),
        to: at("2026-06-11T12:00:00Z"),
      }),
    );
    // Those instants land on 2026-06-10 in Berlin, so the cap applies.
    assert.deepEqual(slots, []);
  });

  it("ignores the cap when the event type sets none", () => {
    const slots = generateSlots(
      query({ bookingsPerDay: { "2026-06-10": 99 } }),
    );
    assert.equal(slots.length, 16);
  });

  it("respects a blocked date override", () => {
    const slots = generateSlots(
      query({
        schedule: schedule({
          overrides: [{ date: "2026-06-10", isBlocked: true }],
        }),
      }),
    );
    assert.deepEqual(slots, []);
  });

  it("uses an override's hours in place of the weekly rule", () => {
    const slots = generateSlots(
      query({
        schedule: schedule({
          overrides: [
            {
              date: "2026-06-10",
              isBlocked: false,
              startMinute: 13 * 60,
              endMinute: 15 * 60,
            },
          ],
        }),
      }),
    );
    assert.deepEqual(isoOf(slots), [
      "2026-06-10T11:00:00.000Z", // 13:00 local
      "2026-06-10T11:30:00.000Z",
      "2026-06-10T12:00:00.000Z",
      "2026-06-10T12:30:00.000Z",
    ]);
  });

  it("returns slots in ascending order across several days", () => {
    const slots = generateSlots(
      query({
        from: at("2026-06-08T00:00:00Z"),
        to: at("2026-06-13T00:00:00Z"),
      }),
    );
    assert.equal(slots.length, 80); // five weekdays × 16
    const times = slots.map((s) => s.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  it("clamps to a slot interval of at least one minute", () => {
    const slots = generateSlots(
      query({
        eventType: eventType({
          durationMinutes: 60,
          slotIntervalMinutes: 0,
        }),
        from: at("2026-06-10T07:00:00Z"),
        to: at("2026-06-10T07:05:00Z"),
      }),
    );
    // A zero step would loop forever; it falls back to one minute.
    assert.deepEqual(isoOf(slots).slice(0, 3), [
      "2026-06-10T07:00:00.000Z",
      "2026-06-10T07:01:00.000Z",
      "2026-06-10T07:02:00.000Z",
    ]);
  });

  describe("across a DST transition", () => {
    const sunday = (startMinute: number, endMinute: number): ScheduleInput =>
      schedule({ rules: [{ weekday: 0, startMinute, endMinute }] });

    it("loses an hour when the clocks spring forward", () => {
      // 2026-03-29, Berlin skips 02:00→03:00. Midnight to 06:00 local is only
      // five real hours.
      const slots = generateSlots(
        query({
          eventType: eventType({ durationMinutes: 60, slotIntervalMinutes: 60 }),
          schedule: sunday(0, 6 * 60),
          from: at("2026-03-28T20:00:00Z"),
          to: at("2026-03-29T08:00:00Z"),
          now: at("2026-03-01T00:00:00Z"),
        }),
      );
      assert.deepEqual(isoOf(slots), [
        "2026-03-28T23:00:00.000Z", // 00:00 local
        "2026-03-29T00:00:00.000Z", // 01:00 local
        "2026-03-29T01:00:00.000Z", // 03:00 local — 02:00 never happens
        "2026-03-29T02:00:00.000Z", // 04:00 local
        "2026-03-29T03:00:00.000Z", // 05:00 local
      ]);
    });

    it("gains an hour when the clocks fall back", () => {
      // 2026-10-25, Berlin repeats 02:00–03:00. Midnight to 06:00 local is
      // seven real hours.
      const slots = generateSlots(
        query({
          eventType: eventType({ durationMinutes: 60, slotIntervalMinutes: 60 }),
          schedule: sunday(0, 6 * 60),
          from: at("2026-10-24T20:00:00Z"),
          to: at("2026-10-25T08:00:00Z"),
          now: at("2026-10-01T00:00:00Z"),
        }),
      );
      assert.equal(slots.length, 7);
      assert.equal(slots[0].toISOString(), "2026-10-24T22:00:00.000Z");
      assert.equal(slots.at(-1)!.toISOString(), "2026-10-25T04:00:00.000Z");
    });

    it("keeps a 09:00 rule at 09:00 local on either side of the change", () => {
      const before = generateSlots(
        query({
          from: at("2026-03-27T00:00:00Z"), // Friday, CET
          to: at("2026-03-28T00:00:00Z"),
          now: at("2026-03-01T00:00:00Z"),
        }),
      );
      const after = generateSlots(
        query({
          from: at("2026-03-30T00:00:00Z"), // Monday, CEST
          to: at("2026-03-31T00:00:00Z"),
          now: at("2026-03-01T00:00:00Z"),
        }),
      );
      assert.equal(before[0].toISOString(), "2026-03-27T08:00:00.000Z");
      assert.equal(after[0].toISOString(), "2026-03-30T07:00:00.000Z");
      assert.equal(before.length, after.length);
    });
  });

  describe("in other host timezones", () => {
    it("works west of UTC, where the local day starts after midnight UTC", () => {
      const slots = generateSlots(
        query({
          schedule: schedule({ timeZone: "America/New_York" }),
        }),
      );
      // 09:00 EDT is 13:00 UTC.
      assert.equal(slots[0].toISOString(), "2026-06-10T13:00:00.000Z");
      assert.equal(slots.length, 16);
    });

    it("works east of UTC, where the local day starts before midnight UTC", () => {
      const slots = generateSlots(
        query({
          schedule: schedule({ timeZone: "Asia/Tokyo" }),
          from: at("2026-06-09T12:00:00Z"),
          to: at("2026-06-10T12:00:00Z"),
        }),
      );
      // 09:00 JST on the 10th is 00:00 UTC on the 10th.
      assert.equal(slots[0].toISOString(), "2026-06-10T00:00:00.000Z");
      assert.equal(slots.length, 16);
    });

    it("handles a half-hour offset zone", () => {
      const slots = generateSlots(
        query({
          schedule: schedule({ timeZone: "Asia/Kolkata" }),
        }),
      );
      // 09:00 IST is 03:30 UTC.
      assert.equal(slots[0].toISOString(), "2026-06-10T03:30:00.000Z");
    });
  });
});

// ---------------------------------------------------------------------------
// Booking-time re-check
// ---------------------------------------------------------------------------

describe("isSlotBookable", () => {
  /** The same fixture as `query`, minus the range the re-check derives itself. */
  function recheckQuery(
    patch: Partial<SlotQuery> = {},
  ): Omit<SlotQuery, "from" | "to"> {
    const base = query(patch);
    return {
      eventType: base.eventType,
      schedule: base.schedule,
      busy: base.busy,
      now: base.now,
      bookingsPerDay: base.bookingsPerDay,
    };
  }

  it("accepts an instant the generator offers", () => {
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T09:00:00Z")),
      true,
    );
  });

  it("accepts the first and last slot of a day", () => {
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T07:00:00Z")),
      true,
    );
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T14:30:00Z")),
      true,
    );
  });

  it("rejects an instant that is off the grid", () => {
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T09:15:00Z")),
      false,
    );
  });

  it("rejects an instant outside the working window", () => {
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T06:00:00Z")),
      false,
    );
    assert.equal(
      isSlotBookable(recheckQuery(), at("2026-06-10T15:00:00Z")),
      false,
    );
  });

  it("rejects a slot that has since been taken", () => {
    const taken = recheckQuery({
      busy: [
        {
          start: at("2026-06-10T09:00:00Z").getTime(),
          end: at("2026-06-10T09:30:00Z").getTime(),
        },
      ],
    });
    assert.equal(isSlotBookable(taken, at("2026-06-10T09:00:00Z")), false);
    assert.equal(isSlotBookable(taken, at("2026-06-10T09:30:00Z")), true);
  });

  it("rejects a slot inside the minimum notice", () => {
    const q = recheckQuery({
      eventType: eventType({ minimumNoticeMinutes: 120 }),
      now: at("2026-06-10T08:10:00Z"),
    });
    assert.equal(isSlotBookable(q, at("2026-06-10T09:00:00Z")), false);
    assert.equal(isSlotBookable(q, at("2026-06-10T10:30:00Z")), true);
  });

  it("rejects a slot on a blocked date", () => {
    const q = recheckQuery({
      schedule: schedule({
        overrides: [{ date: "2026-06-10", isBlocked: true }],
      }),
    });
    assert.equal(isSlotBookable(q, at("2026-06-10T09:00:00Z")), false);
  });

  it("rejects a slot on a day already at its cap", () => {
    const q = recheckQuery({
      eventType: eventType({ maxBookingsPerDay: 1 }),
      bookingsPerDay: { "2026-06-10": 1 },
    });
    assert.equal(isSlotBookable(q, at("2026-06-10T09:00:00Z")), false);
  });

  it("validates a slot at the far edge of a long working window", () => {
    // The ±1 day search has to expand the whole window in one piece for the
    // grid to line up, which is what this guards.
    const q = recheckQuery({
      schedule: schedule({
        rules: [{ weekday: 3, startMinute: 0, endMinute: 24 * 60 }],
      }),
    });
    assert.equal(isSlotBookable(q, at("2026-06-09T22:00:00Z")), true); // 00:00 local
    assert.equal(isSlotBookable(q, at("2026-06-10T21:30:00Z")), true); // 23:30 local
  });
});
