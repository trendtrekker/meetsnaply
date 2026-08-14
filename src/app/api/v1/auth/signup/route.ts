import type { NextRequest } from "next/server";
import { signUpInput, type SessionResponse } from "@/lib/api/contracts";
import { fail, ok, parseBody } from "@/lib/api/respond";
import { createAccount } from "@/lib/auth/accounts";
import { signSession } from "@/lib/auth/session";

/** Creates an account and returns a session, seeding a schedule and two event types. */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, signUpInput);
  if (!parsed.ok) return parsed.response;

  const result = await createAccount(parsed.data);
  if (!result.ok) {
    return fail(
      "invalid_request",
      "Some fields need attention.",
      result.fieldErrors,
    );
  }

  const { user } = result;
  const token = await signSession({
    userId: user.id,
    email: user.email,
    username: user.username,
  });

  return ok<SessionResponse>({ token, user }, 201);
}
