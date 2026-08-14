import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "./session";

/**
 * The fields that make up a signed-in user everywhere they are needed — the
 * dashboard, and the API's `/me`. Never includes `passwordHash`.
 */
export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  username: true,
  avatarUrl: true,
  bio: true,
  timeZone: true,
  brandColor: true,
} as const;

/** Current user or null. Deduped per request. */
export const getCurrentUser = cache(async () => {
  const session = await getSession();
  if (!session) return null;

  return db.user.findUnique({
    where: { id: session.userId },
    select: USER_SELECT,
  });
});

/** Current user, or redirect to login. Use in every dashboard route. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type CurrentUser = NonNullable<
  Awaited<ReturnType<typeof getCurrentUser>>
>;
