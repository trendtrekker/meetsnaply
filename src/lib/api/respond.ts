import "server-only";
import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * One JSON shape for every `/api/v1` response, so a client never has to guess
 * how a failure arrived.
 *
 * Success is the payload itself. Failure is always
 * `{ error: { code, message, fieldErrors? } }` with a matching HTTP status.
 * `fieldErrors` mirrors the `fieldErrors` the web forms already render, so the
 * same validation feeds both a browser form and a native one.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "conflict"
  | "unavailable";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 422,
  conflict: 409,
  unavailable: 503,
};

export interface ApiError {
  error: {
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string>;
  };
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(
  code: ApiErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
) {
  return NextResponse.json<ApiError>(
    { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } },
    { status: STATUS[code] },
  );
}

export const unauthorized = () =>
  fail("unauthorized", "Sign in to continue.");

export const notFound = (what = "That doesn't exist.") =>
  fail("not_found", what);

/**
 * Collapses zod issues to one message per field, matching `flatten` in
 * src/lib/auth/actions.ts — the first issue per field is the one shown.
 */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Parses and validates a JSON body. Returns either the typed data or the
 * response to send back, so handlers stay a straight line:
 *
 *     const parsed = await parseBody(request, schema);
 *     if (!parsed.ok) return parsed.response;
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<
  { ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: fail("invalid_request", "Expected a JSON body."),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(
        "invalid_request",
        "Some fields need attention.",
        fieldErrorsOf(parsed.error),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}
