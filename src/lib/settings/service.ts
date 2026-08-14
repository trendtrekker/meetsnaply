import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { USER_SELECT, type CurrentUser } from "@/lib/auth";
import type { UpdateSettingsInput } from "@/lib/api/contracts";

/**
 * Profile settings, independent of transport.
 *
 * One wrinkle shapes the result type: the handle is baked into the session
 * token, so changing it invalidates the caller's current credential. The web
 * app fixes that by reissuing a cookie; a native client needs a *new token* in
 * the response. Rather than guess, this reports `usernameChanged` and lets each
 * caller reissue in its own currency.
 */

export type UpdateSettingsResult =
  | { ok: true; user: CurrentUser; usernameChanged: boolean }
  | { ok: false; fieldErrors: Record<string, string> };

export async function updateProfile(
  user: CurrentUser,
  input: UpdateSettingsInput,
): Promise<UpdateSettingsResult> {
  const usernameChanged = input.username !== user.username;

  if (usernameChanged) {
    const taken = await db.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (taken) {
      return { ok: false, fieldErrors: { username: "That handle is taken" } };
    }
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      name: input.name,
      username: input.username,
      bio: input.bio || null,
      timeZone: input.timeZone,
    },
    select: USER_SELECT,
  });

  revalidatePath("/dashboard");
  return { ok: true, user: updated, usernameChanged };
}
