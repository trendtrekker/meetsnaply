import Constants from "expo-constants";

/**
 * The one place that talks to the server.
 *
 * Every call goes through `request`, so the token, the error shape, and the
 * base URL are decided once. React Native's fetch does not enforce CORS, which
 * is why the API needed no cross-origin handling for this client.
 */

/** Matches the server's `{ error: { code, message, fieldErrors? } }`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.error?.code ?? "unknown";
    this.fieldErrors = body?.error?.fieldErrors ?? {};
  }
}

/**
 * Where the server is.
 *
 * `EXPO_PUBLIC_API_URL` wins. Failing that, the dev server's own host is used:
 * Expo already knows the machine address it served this bundle from, and that
 * is the same machine running Next, so a phone that can load the app can reach
 * the API without anything being hard-coded to one network.
 */
export function apiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:3000`;

  // Nothing left to infer from — the simulator's own loopback.
  return "http://localhost:3000";
}

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = {};
  if (auth && authToken) headers.Authorization = `Bearer ${authToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}/api/v1${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // A dead server and a phone on the wrong network look identical here, and
    // the fix is the same either way, so say both.
    throw new ApiError(
      0,
      null,
      `Can't reach ${apiBaseUrl()}. Check the server is running and that this phone is on the same network.`,
    );
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed as ApiErrorBody | null,
      `Request failed (${response.status})`,
    );
  }

  return parsed as T;
}
