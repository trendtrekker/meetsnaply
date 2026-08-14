import type { NextRequest } from "next/server";
import { signInInput, type SessionResponse } from "@/lib/api/contracts";
import { fail, ok, parseBody } from "@/lib/api/respond";
import { authenticate } from "@/lib/auth/accounts";
import { signSession } from "@/lib/auth/session";

/**
 * Exchanges credentials for the session JWT.
 *
 * The token is the same one the web app puts in an httpOnly cookie. A native
 * client has no cookie jar, so it gets the token in the body and sends it back
 * as `Authorization: Bearer <token>`.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, signInInput);
  if (!parsed.ok) return parsed.response;

  const user = await authenticate(parsed.data);
  if (!user) {
    // Deliberately not "no such email" vs "wrong password" — same answer for
    // both, matching the web form and the constant-time comparison behind it.
    return fail(
      "unauthorized",
      "Those credentials don't match an account.",
    );
  }

  const token = await signSession({
    userId: user.id,
    email: user.email,
    username: user.username,
  });

  return ok<SessionResponse>({ token, user });
}
