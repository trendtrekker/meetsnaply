import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { saveScheduleInput } from "@/lib/api/contracts";
import { fail, notFound, ok, parseBody, unauthorized } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { saveWeeklyRules } from "@/lib/availability/schedule-service";

/** The caller's schedules, default first, with their rules and overrides. */
async function schedulesFor(userId: string) {
  return db.schedule.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: {
      rules: { orderBy: [{ weekday: "asc" }, { startMinute: "asc" }] },
      overrides: { orderBy: { date: "asc" } },
    },
  });
}

export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  return ok({ schedules: await schedulesFor(user.id) });
}

/**
 * Replaces the whole week in one call.
 *
 * Deliberately a full replacement rather than a patch: "Wednesday now has no
 * windows" has to be expressible, and a partial update cannot say it.
 */
export async function PUT(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const parsed = await parseBody(request, saveScheduleInput);
  if (!parsed.ok) return parsed.response;

  const result = await saveWeeklyRules(user.id, parsed.data);
  if (!result.ok) {
    // "Schedule not found" is ownership; the rest are rule conflicts the user
    // can fix, so they come back as a validation failure against the form.
    return result.error === "Schedule not found"
      ? notFound(result.error)
      : fail("invalid_request", result.error, { rules: result.error });
  }

  return ok({ schedules: await schedulesFor(user.id) });
}
