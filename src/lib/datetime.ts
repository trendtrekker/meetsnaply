/**
 * Display helpers. All of these take an explicit timezone — nothing in this
 * app is allowed to render a date in the server's local zone.
 */

/** "YYYY-MM-DD" for an instant as seen in `timeZone`. */
export function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatTime(date: Date, timeZone: string, hour12 = false) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).format(date);
}

/** "9 DEC" — the compact date pill used in the bookings list. */
export function formatDayMonth(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
  })
    .format(date)
    .toUpperCase();
}

export function formatDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function formatDateTime(date: Date, timeZone: string, hour12 = false) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  }).format(date);
}

/** "GMT+2" style abbreviation for the zone at that instant. */
export function zoneAbbreviation(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

/** Month key "YYYY-MM" for an instant in a zone. */
export function monthKey(date: Date, timeZone: string) {
  return dayKey(date, timeZone).slice(0, 7);
}

export function parseMonthKey(value: string | undefined, fallback: Date) {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return { year: fallback.getUTCFullYear(), month: fallback.getUTCMonth() };
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

export function shiftMonthKey(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * Calendar grid for a month, Monday-first, padded with the neighbouring days
 * so every row has seven cells.
 */
export function monthGrid(key: string) {
  const [year, month] = key.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  // getUTCDay(): 0=Sun. Shift so Monday is column 0.
  const leading = (first.getUTCDay() + 6) % 7;

  const cells: { key: string; day: number; inMonth: boolean }[] = [];

  for (let i = leading; i > 0; i--) {
    const d = new Date(Date.UTC(year, month - 1, 1 - i));
    cells.push({
      key: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: false,
    });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month - 1, day));
    cells.push({ key: d.toISOString().slice(0, 10), day, inMonth: true });
  }
  let trailing = 1;
  while (cells.length % 7 !== 0) {
    const d = new Date(Date.UTC(year, month - 1, daysInMonth + trailing));
    cells.push({
      key: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: false,
    });
    trailing++;
  }

  return cells;
}

export const WEEKDAY_LABELS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Zones offered in the picker. Falls back to a short curated list. */
export function supportedTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;

  if (typeof supported === "function") {
    try {
      return supported("timeZone");
    } catch {
      /* fall through */
    }
  }
  return [
    "UTC",
    "Europe/London",
    "Europe/Berlin",
    "Europe/Madrid",
    "America/New_York",
    "America/Chicago",
    "America/Los_Angeles",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
}
