import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { tryDecrypt } from "@/lib/crypto";
import { revokeToken } from "./google";

/**
 * Connected-calendar management, independent of transport.
 *
 * Every function is scoped by `userId` and returns `{ ok: false }` rather than
 * throwing when the connection is not the caller's — a request for someone
 * else's calendar is indistinguishable from one for a connection that no longer
 * exists, and should stay that way.
 */

async function ownedConnection(userId: string, id: string) {
  return db.calendarConnection.findFirst({
    where: { id, userId },
    select: { id: true, accessToken: true, refreshToken: true },
  });
}

export async function disconnectCalendarForUser(
  userId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const connection = await ownedConnection(userId, id);
  if (!connection) return { ok: false };

  // Hand the grant back to Google before dropping our copy, so a disconnect
  // here actually revokes access rather than just forgetting the token.
  const refreshToken = tryDecrypt(connection.refreshToken);
  const accessToken = tryDecrypt(connection.accessToken);
  if (refreshToken ?? accessToken) {
    await revokeToken((refreshToken ?? accessToken)!);
  }

  await db.calendarConnection.delete({ where: { id: connection.id } });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export async function setConflictChecking(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<{ ok: boolean }> {
  const { count } = await db.calendarConnection.updateMany({
    where: { id, userId },
    // Re-enabling is also how a user clears a previous failure.
    data: {
      checkConflicts: enabled,
      ...(enabled ? { lastError: null, lastErrorAt: null } : {}),
    },
  });

  revalidatePath("/dashboard/settings");
  return { ok: count > 0 };
}

export async function setDestinationCalendarForUser(
  userId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const connection = await ownedConnection(userId, id);
  if (!connection) return { ok: false };

  // At most one destination per user, so demote the rest in the same
  // transaction — two destinations would double-write every booking.
  await db.$transaction([
    db.calendarConnection.updateMany({
      where: { userId },
      data: { isDestination: false },
    }),
    db.calendarConnection.update({
      where: { id: connection.id },
      data: { isDestination: true },
    }),
  ]);

  revalidatePath("/dashboard/settings");
  return { ok: true };
}
