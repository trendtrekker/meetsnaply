import { z } from "zod";
import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { notFound, ok, parseBody, unauthorized } from "@/lib/api/respond";
import {
  disconnectCalendarForUser,
  setConflictChecking,
  setDestinationCalendarForUser,
} from "@/lib/calendar/service";

/** Both toggles on one connection, either or both per call. */
const patchInput = z
  .object({
    checkConflicts: z.boolean().optional(),
    isDestination: z.literal(true).optional(),
  })
  .refine(
    (data) => data.checkConflicts !== undefined || data.isDestination === true,
    { message: "Nothing to change" },
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const { id } = await params;
  const parsed = await parseBody(request, patchInput);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.checkConflicts !== undefined) {
    const result = await setConflictChecking(
      user.id,
      id,
      parsed.data.checkConflicts,
    );
    if (!result.ok) return notFound("No such calendar connection.");
  }

  // Only ever promoting: demoting one destination without naming a replacement
  // would leave bookings with nowhere to write.
  if (parsed.data.isDestination) {
    const result = await setDestinationCalendarForUser(user.id, id);
    if (!result.ok) return notFound("No such calendar connection.");
  }

  return ok({ updated: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const result = await disconnectCalendarForUser(user.id, (await params).id);
  if (!result.ok) return notFound("No such calendar connection.");

  return ok({ disconnected: true });
}
