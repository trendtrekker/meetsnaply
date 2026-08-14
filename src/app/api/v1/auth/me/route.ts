import type { NextRequest } from "next/server";
import type { UserResponse } from "@/lib/api/contracts";
import { apiUser } from "@/lib/api/auth";
import { ok, unauthorized } from "@/lib/api/respond";

/**
 * The bearer's own account.
 *
 * A client calls this on launch to decide whether its stored token is still
 * good — the token is self-expiring, but the account behind it can change or
 * disappear inside the thirty-day window.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  return ok<UserResponse>(user);
}
