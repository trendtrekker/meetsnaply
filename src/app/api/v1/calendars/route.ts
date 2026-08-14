import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { ok, unauthorized } from "@/lib/api/respond";
import { db } from "@/lib/db";

/**
 * Connected calendars.
 *
 * The token columns are deliberately absent from the select: they are encrypted
 * at rest and have no business leaving the server even in that form.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const connections = await db.calendarConnection.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      provider: true,
      accountEmail: true,
      calendarId: true,
      checkConflicts: true,
      isDestination: true,
      lastError: true,
      lastErrorAt: true,
      createdAt: true,
    },
  });

  return ok({ connections });
}
