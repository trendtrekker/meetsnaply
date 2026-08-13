import "server-only";

/**
 * Google Calendar over plain fetch.
 *
 * Deliberately no `googleapis` dependency: we use four endpoints, and the SDK
 * is tens of megabytes with its own auth caching that fights Next's request
 * lifecycle. Everything here is a documented REST call.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_SCOPES = [
  // Read/write events. `calendar.events` is narrower than full `calendar`
  // access and is all we need — we never create or delete calendars.
  "https://www.googleapis.com/auth/calendar.events",
  // Free/busy plus the calendar list, read-only.
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

/** Thrown when Google says the grant is gone and the user must reconnect. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Thrown for transient failures — network, 5xx, rate limit. */
export class GoogleTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleTransientError";
  }
}

export function isGoogleConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function credentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to use Google Calendar.",
    );
  }
  return { clientId, clientSecret };
}

export function redirectUri() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/calendar/google/callback`;
}

/** Consent screen URL. `state` is a signed token we verify on the way back. */
export function consentUrl(state: string) {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // `offline` is what gets us a refresh token at all; `consent` forces the
    // prompt so re-connecting an account still returns one. Google only sends
    // a refresh token on first authorisation otherwise.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string | null;
}

async function requestTokens(body: URLSearchParams): Promise<GoogleTokens> {
  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (cause) {
    throw new GoogleTransientError(`Could not reach Google: ${String(cause)}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    const detail =
      payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
    // invalid_grant means the refresh token was revoked or expired — no amount
    // of retrying fixes it, the user has to reconnect.
    if (payload.error === "invalid_grant" || response.status === 400) {
      throw new GoogleAuthError(detail);
    }
    throw new GoogleTransientError(detail);
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000),
    scope: payload.scope ?? null,
  };
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  return requestTokens(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  );
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<GoogleTokens> {
  const { clientId, clientSecret } = credentials();
  const tokens = await requestTokens(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  );
  // A refresh response usually omits the refresh token; keep the existing one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best effort. We still drop our copy of the credentials either way.
  }
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

async function call<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (cause) {
    throw new GoogleTransientError(`Could not reach Google: ${String(cause)}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new GoogleAuthError(
      `Google rejected the request (${response.status}). The grant may have been revoked.`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new GoogleTransientError(
      `Google Calendar error ${response.status}: ${body.slice(0, 300)}`,
    );
  }
  if (response.status === 204) return undefined as T;

  return (await response.json()) as T;
}

export async function fetchAccountEmail(accessToken: string) {
  let response: Response;
  try {
    response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (cause) {
    throw new GoogleTransientError(`Could not reach Google: ${String(cause)}`);
  }
  if (!response.ok) {
    throw new GoogleAuthError(`Could not read the Google account (${response.status})`);
  }
  const payload = (await response.json()) as { email?: string; id?: string };
  return { email: payload.email ?? "unknown", id: payload.id ?? null };
}

export interface BusyInterval {
  start: number;
  end: number;
}

/**
 * Busy blocks from one calendar.
 *
 * freeBusy is the right endpoint here rather than events.list: it collapses
 * recurring events, respects transparency ("free" events don't block), and
 * returns nothing but intervals — no attendee data we have no business
 * reading.
 */
export async function fetchFreeBusy(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date,
): Promise<BusyInterval[]> {
  const payload = await call<{
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
    >;
  }>(accessToken, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      items: [{ id: calendarId }],
    }),
  });

  const calendar = payload.calendars?.[calendarId];
  if (calendar?.errors?.length) {
    const reason = calendar.errors[0].reason;
    if (reason === "notFound" || reason === "forbidden") {
      throw new GoogleAuthError(`Calendar "${calendarId}" is not accessible.`);
    }
    throw new GoogleTransientError(`freeBusy failed: ${reason}`);
  }

  return (calendar?.busy ?? []).map((slot) => ({
    start: new Date(slot.start).getTime(),
    end: new Date(slot.end).getTime(),
  }));
}

export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
}

export async function listCalendars(
  accessToken: string,
): Promise<CalendarSummary[]> {
  const payload = await call<{
    items?: {
      id: string;
      summary?: string;
      primary?: boolean;
      accessRole?: string;
    }[];
  }>(accessToken, "/users/me/calendarList?minAccessRole=writer&maxResults=250");

  return (payload.items ?? []).map((item) => ({
    id: item.id,
    summary: item.summary ?? item.id,
    primary: Boolean(item.primary),
    accessRole: item.accessRole ?? "reader",
  }));
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  /// IANA zone. Google stores the instant but shows this zone in the UI.
  timeZone: string;
  location?: string;
  attendees?: { email: string; displayName?: string }[];
  /** Our booking uid, so a duplicate insert is rejected by Google. */
  requestId?: string;
}

function toEventResource(input: CalendarEventInput) {
  return {
    summary: input.summary,
    description: input.description,
    location: input.location,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    attendees: input.attendees?.map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
    })),
    // We send our own confirmations; letting Google email as well would double
    // up on every invitee.
    guestsCanModify: false,
    source: {
      title: "meetsnaply",
      url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    },
  };
}

export async function insertEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<{ id: string; htmlLink?: string }> {
  return call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`,
    { method: "POST", body: JSON.stringify(toEventResource(input)) },
  );
}

export async function patchEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<{ id: string }> {
  return call(
    accessToken,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    { method: "PATCH", body: JSON.stringify(toEventResource(input)) },
  );
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  try {
    await call<void>(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already gone is the desired end state, not a failure.
    if (
      error instanceof GoogleTransientError &&
      /error (404|410):/.test(error.message)
    ) {
      return;
    }
    throw error;
  }
}
