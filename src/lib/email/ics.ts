/**
 * iCalendar (RFC 5545) invite generation.
 *
 * Hand-rolled rather than pulled from a library because the format's real
 * constraints are few and specific, and getting them wrong is silent: Outlook
 * and Google both discard a malformed VEVENT without telling the sender. The
 * four that matter are CRLF line endings, octet-based line folding, text
 * escaping, and UTC timestamps.
 */

export type CalendarMethod = "REQUEST" | "CANCEL";

export interface CalendarAttendee {
  name: string;
  email: string;
  /** Organizers are marked CHAIR; everyone else REQ-PARTICIPANT. */
  isOrganizer?: boolean;
}

export interface CalendarEventInput {
  /** Stable across updates and cancellations — clients match on it. */
  uid: string;
  method: CalendarMethod;
  sequence: number;
  title: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start: Date;
  end: Date;
  organizer: { name: string; email: string };
  attendees: CalendarAttendee[];
}

/** RFC 5545 §3.3.5: UTC date-time, e.g. 20260812T140000Z. */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

/**
 * RFC 5545 §3.3.11: backslash, semicolon and comma are escaped, and newlines
 * become a literal `\n`. An unescaped comma in a summary silently truncates the
 * property at that point in some clients.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 §3.1: lines are folded at 75 **octets**, not characters.
 *
 * Folding on characters corrupts any line containing multi-byte UTF-8 — a name
 * with an accent, an em dash in a description — because the split can land
 * mid-codepoint. This walks the UTF-8 encoding and only breaks on a boundary.
 */
function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const chunks: string[] = [];
  let start = 0;

  while (start < bytes.length) {
    // 75 octets on the first line; continuations lose one to the leading space.
    const limit = chunks.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);

    // Back off until `end` sits on a codepoint boundary. Continuation bytes
    // match 0b10xxxxxx.
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    }

    chunks.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }

  return chunks.join("\r\n ");
}

function property(name: string, value: string, params?: string): string {
  return foldLine(`${name}${params ? `;${params}` : ""}:${value}`);
}

/**
 * Builds a complete VCALENDAR.
 *
 * `METHOD:CANCEL` plus a higher SEQUENCE is what removes an event from a
 * recipient's calendar; sending a REQUEST with STATUS:CANCELLED does not.
 */
export function buildCalendarInvite(input: CalendarEventInput): string {
  const cancelled = input.method === "CANCEL";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//meetsnaply//booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    property("UID", input.uid),
    property("DTSTAMP", formatUtc(new Date())),
    property("DTSTART", formatUtc(input.start)),
    property("DTEND", formatUtc(input.end)),
    property("SEQUENCE", String(input.sequence)),
    property("SUMMARY", escapeText(input.title)),
    property("STATUS", cancelled ? "CANCELLED" : "CONFIRMED"),
    property(
      "ORGANIZER",
      `mailto:${input.organizer.email}`,
      `CN=${escapeText(input.organizer.name)}`,
    ),
  ];

  if (input.description) {
    lines.push(property("DESCRIPTION", escapeText(input.description)));
  }
  if (input.location) {
    lines.push(property("LOCATION", escapeText(input.location)));
  }
  if (input.url) {
    lines.push(property("URL", input.url));
  }

  for (const attendee of input.attendees) {
    lines.push(
      property(
        "ATTENDEE",
        `mailto:${attendee.email}`,
        [
          `CN=${escapeText(attendee.name)}`,
          `ROLE=${attendee.isOrganizer ? "CHAIR" : "REQ-PARTICIPANT"}`,
          // NEEDS-ACTION is what makes a client show accept/decline buttons.
          "PARTSTAT=NEEDS-ACTION",
          "RSVP=TRUE",
        ].join(";"),
      ),
    );
  }

  // A cancelled event has nothing left to alarm about.
  if (!cancelled) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      property("DESCRIPTION", escapeText(input.title)),
      "TRIGGER:-PT10M",
      "END:VALARM",
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  // RFC 5545 §3.1 requires CRLF; a bare \n makes strict parsers reject the file.
  return `${lines.join("\r\n")}\r\n`;
}
