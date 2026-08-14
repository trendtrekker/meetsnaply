import "server-only";
import { db } from "@/lib/db";
import { USER_SELECT } from "@/lib/auth";
import { getSessionFromRequest } from "@/lib/auth/session";

/**
 * The API's counterpart to `requireUser()`.
 *
 * The dashboard's version redirects to /login, which is meaningless to a native
 * client, so this returns null and lets the handler answer 401. Unlike
 * `getCurrentUser` it is not wrapped in React's `cache` — that dedupes per
 * render pass, and a route handler is not one.
 */
export async function apiUser(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) return null;

  // Re-read the user rather than trusting the token's claims: the JWT lives for
  // thirty days, and a name, handle, or timezone can change inside that window.
  return db.user.findUnique({
    where: { id: session.userId },
    select: USER_SELECT,
  });
}

export type ApiUser = NonNullable<Awaited<ReturnType<typeof apiUser>>>;
