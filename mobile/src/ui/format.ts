/**
 * Date formatting for the booking lists.
 *
 * Everything renders in the *booking's* timezone rather than the phone's. A
 * host abroad still needs to read "11:00" and have it mean the time the
 * meeting was agreed for.
 */

function parts(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(
    new Date(iso),
  );
}

export function timeOf(iso: string, timeZone: string) {
  return parts(iso, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function dayOf(iso: string, timeZone: string) {
  return parts(iso, timeZone, { day: "numeric", month: "short" }).toUpperCase();
}

export function longDateOf(iso: string, timeZone: string) {
  return parts(iso, timeZone, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function durationBetween(startIso: string, endIso: string) {
  const minutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000,
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}
