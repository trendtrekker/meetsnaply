import { z } from "zod";

/**
 * Request shapes for `/api/v1`, and the validation rules behind them.
 *
 * These are deliberately not `server-only`: they are the contract, and the
 * schemas are the single definition of what "a valid sign-up" means. The web
 * server actions in src/lib/auth/actions.ts parse their `FormData` through the
 * same objects, so a rule tightened here tightens in both places at once.
 *
 * Response shapes live alongside as plain types — they are what the handlers
 * return, mirrored by hand in mobile/src/api/types.ts.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signUpInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  timeZone: z.string().trim().min(1).default("UTC"),
});

export const signInInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

export type SignUpInput = z.infer<typeof signUpInput>;
export type SignInInput = z.infer<typeof signInInput>;

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

/** At most ten guests, each a real address. */
export const guestEmails = z
  .array(z.string().email("One of the guest emails is invalid"))
  .max(10)
  .default([]);

export const bookSlotInput = z.object({
  username: z.string().min(1),
  slug: z.string().min(1),
  /** The exact instant being booked, ISO 8601 with an offset. */
  start: z.string().datetime({ offset: true }),
  timeZone: z.string().min(1),
  name: z.string().trim().min(1, "Enter your name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  guests: guestEmails,
  consentRecording: z.boolean().default(false),
  /** Public uid of the booking this one replaces. */
  rescheduleOf: z.string().optional(),
  /**
   * Answers to the host's custom questions, keyed by question *identifier*.
   * Multi-value answers arrive as arrays and are stored comma-joined, matching
   * what the web form's repeated fields produce.
   */
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string())])).default({}),
});

export const cancelBookingInput = z.object({
  uid: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export const setBookingStatusInput = z.object({
  uid: z.string().min(1),
  status: z.enum(["CONFIRMED", "REJECTED", "CANCELLED"]),
});

export type BookSlotInput = z.infer<typeof bookSlotInput>;
export type CancelBookingInput = z.infer<typeof cancelBookingInput>;
export type SetBookingStatusInput = z.infer<typeof setBookingStatusInput>;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export const LOCATION_TYPES = [
  "MEETSNAPLY_VIDEO",
  "GOOGLE_MEET",
  "ZOOM",
  "MICROSOFT_TEAMS",
  "PHONE_HOST_CALLS",
  "PHONE_INVITEE_CALLS",
  "IN_PERSON",
  "CUSTOM",
] as const;

/**
 * An event type as both surfaces describe it: real booleans, real numbers, a
 * real array of reminder offsets. The web form speaks in `"on"` checkboxes and
 * comma-separated strings, and converts before it gets here — see `readForm`
 * in ./event-types/actions.ts.
 */
export const eventTypeInput = z
  .object({
    title: z.string().trim().min(1, "Give it a name").max(120),
    // Nullish, not optional: these columns are nullable, so a client that reads
    // an event type and sends it back sends `null` — and rejecting your own
    // representation would make read-modify-write impossible.
    slug: z.string().trim().max(60).nullish(),
    description: z.string().trim().max(2000).nullish(),
    durationMinutes: z.coerce.number().int().min(5).max(720),
    slotIntervalMinutes: z.coerce.number().int().min(5).max(120),
    bufferBeforeMinutes: z.coerce.number().int().min(0).max(240),
    bufferAfterMinutes: z.coerce.number().int().min(0).max(240),
    minimumNoticeMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
    bookingHorizonDays: z.coerce.number().int().min(1).max(730),
    maxBookingsPerDay: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .nullable()
      .default(null),
    /** Minutes before the meeting. Deduped, latest-first, capped at five. */
    reminderMinutes: z
      .array(z.coerce.number().int().positive())
      .default([])
      .transform((list) =>
        list
          // Deduped so a typo can't email everyone twice at the same moment,
          // and descending so the earliest reminder is listed first.
          .filter((minutes, index, all) => all.indexOf(minutes) === index)
          .sort((a, b) => b - a)
          .slice(0, 5),
      ),
    locationType: z.enum(LOCATION_TYPES),
    locationValue: z.string().trim().max(500).nullish(),
    scheduleId: z.string().nullish(),
    isActive: z.boolean().default(false),
    isPrivate: z.boolean().default(false),
    requiresConfirmation: z.boolean().default(false),
    recordingEnabled: z.boolean().default(false),
    transcriptionEnabled: z.boolean().default(false),
    sendRecapToAttendees: z.boolean().default(false),
  })
  .refine((data) => data.locationType !== "IN_PERSON" || data.locationValue, {
    message: "Add the address",
    path: ["locationValue"],
  });

export const deleteEventTypeInput = z.object({ id: z.string().min(1) });

export type EventTypeInputPayload = z.infer<typeof eventTypeInput>;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Minutes from local midnight. 1440 is a valid *end* — a window running to
 * midnight — which is why the ceiling is inclusive.
 */
const minuteOfDay = z.number().int().min(0).max(1440);

export const weeklyRuleInput = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: minuteOfDay,
  endMinute: minuteOfDay,
});

export const saveScheduleInput = z.object({
  scheduleId: z.string().min(1),
  timeZone: z.string().trim().optional(),
  /** The complete set of windows. An empty array clears the week. */
  rules: z.array(weeklyRuleInput).max(70),
});

export const dateOverrideInput = z.object({
  scheduleId: z.string().min(1),
  /** Host-local calendar date, "YYYY-MM-DD". */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD"),
  blocked: z.boolean().default(false),
  startMinute: minuteOfDay.nullish(),
  endMinute: minuteOfDay.nullish(),
});

export const deleteDateOverrideInput = z.object({ id: z.string().min(1) });

export type WeeklyRuleInput = z.infer<typeof weeklyRuleInput>;
export type SaveScheduleInput = z.infer<typeof saveScheduleInput>;
export type DateOverrideInput = z.infer<typeof dateOverrideInput>;
export type DeleteDateOverrideInput = z.infer<typeof deleteDateOverrideInput>;

// ---------------------------------------------------------------------------
// Settings and calendar
// ---------------------------------------------------------------------------

export const updateSettingsInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(40)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Letters, numbers and hyphens only",
    ),
  // Nullable in the database, so a read-modify-write round trip sends null.
  bio: z.string().trim().max(300).nullish(),
  timeZone: z.string().trim().min(1),
});

export const calendarConnectionInput = z.object({ id: z.string().min(1) });

export const conflictCheckingInput = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
export type CalendarConnectionInput = z.infer<typeof calendarConnectionInput>;
export type ConflictCheckingInput = z.infer<typeof conflictCheckingInput>;

// ---------------------------------------------------------------------------
// Shared response shapes
// ---------------------------------------------------------------------------

/** The signed-in user as every endpoint returns them. Never carries secrets. */
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  bio: string | null;
  timeZone: string;
  brandColor: string | null;
}

/**
 * What a native client gets on login. The token is the same JWT the browser
 * keeps in its session cookie, and expires on the same thirty-day clock.
 */
export interface SessionResponse {
  token: string;
  user: UserResponse;
}
