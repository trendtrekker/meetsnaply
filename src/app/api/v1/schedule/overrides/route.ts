import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { dateOverrideInput } from "@/lib/api/contracts";
import { notFound, ok, parseBody, unauthorized } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { upsertDateOverride } from "@/lib/availability/schedule-service";

/**
 * Adds or replaces the override for one date.
 *
 * An upsert rather than a create: one date has at most one override, and
 * sending the same date twice should move it, not fail.
 */
export async function POST(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const parsed = await parseBody(request, dateOverrideInput);
  if (!parsed.ok) return parsed.response;

  const result = await upsertDateOverride(user.id, parsed.data);
  if (!result.ok) return notFound("No such schedule.");

  const overrides = await db.dateOverride.findMany({
    where: { scheduleId: parsed.data.scheduleId },
    orderBy: { date: "asc" },
  });

  return ok({ overrides });
}
