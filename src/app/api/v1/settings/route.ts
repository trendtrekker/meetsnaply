import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { updateSettingsInput } from "@/lib/api/contracts";
import { fail, ok, parseBody, unauthorized } from "@/lib/api/respond";
import { signSession } from "@/lib/auth/session";
import { updateProfile } from "@/lib/settings/service";

export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  return ok({ user });
}

/**
 * Updates the profile, and reissues the token when the handle changes.
 *
 * The handle is a claim inside the JWT. Changing it does *not* lock the caller
 * out — every authenticated route resolves the user by id, so the old token
 * keeps working — but the claim it carries is now stale, and anything that
 * reads it would be reading a name the user no longer has. The web app swaps
 * the cookie; a native client cannot, so the replacement comes back here.
 *
 * `token` is present only when it actually changed, so a client can store it
 * unconditionally without churning its keychain on every save.
 */
export async function PATCH(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const parsed = await parseBody(request, updateSettingsInput);
  if (!parsed.ok) return parsed.response;

  const result = await updateProfile(user, parsed.data);
  if (!result.ok) {
    return fail(
      "invalid_request",
      "Some fields need attention.",
      result.fieldErrors,
    );
  }

  if (!result.usernameChanged) {
    return ok({ user: result.user });
  }

  const token = await signSession({
    userId: result.user.id,
    email: result.user.email,
    username: result.user.username,
  });

  return ok({ user: result.user, token });
}
