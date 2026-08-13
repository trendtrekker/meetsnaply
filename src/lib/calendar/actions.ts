"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { tryDecrypt } from "@/lib/crypto";
import { revokeToken } from "./google";

async function ownedConnection(userId: string, id: string) {
  return db.calendarConnection.findFirst({
    where: { id, userId },
    select: { id: true, accessToken: true, refreshToken: true },
  });
}

export async function disconnectCalendar(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const connection = await ownedConnection(user.id, id);
  if (!connection) return;

  // Hand the grant back to Google before dropping our copy, so a disconnect
  // here actually revokes access rather than just forgetting the token.
  const refreshToken = tryDecrypt(connection.refreshToken);
  const accessToken = tryDecrypt(connection.accessToken);
  if (refreshToken ?? accessToken) {
    await revokeToken((refreshToken ?? accessToken)!);
  }

  await db.calendarConnection.delete({ where: { id: connection.id } });

  revalidatePath("/dashboard/settings");
}

export async function toggleConflictChecking(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const enabled = formData.get("enabled") === "true";
  if (!id) return;

  await db.calendarConnection.updateMany({
    where: { id, userId: user.id },
    // Re-enabling is also how a user clears a previous failure.
    data: {
      checkConflicts: enabled,
      ...(enabled ? { lastError: null, lastErrorAt: null } : {}),
    },
  });

  revalidatePath("/dashboard/settings");
}

export async function setDestinationCalendar(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const connection = await ownedConnection(user.id, id);
  if (!connection) return;

  // At most one destination per user, so demote the rest in the same
  // transaction — two destinations would double-write every booking.
  await db.$transaction([
    db.calendarConnection.updateMany({
      where: { userId: user.id },
      data: { isDestination: false },
    }),
    db.calendarConnection.update({
      where: { id: connection.id },
      data: { isDestination: true },
    }),
  ]);

  revalidatePath("/dashboard/settings");
}
