import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { eventTypeInput } from "@/lib/api/contracts";
import { notFound, ok, parseBody, unauthorized } from "@/lib/api/respond";
import { db } from "@/lib/db";
import {
  removeEventType,
  updateEventTypeFor,
} from "@/lib/event-types/service";

async function owned(userId: string, id: string) {
  return db.eventType.findFirst({
    where: { id, userId },
    include: { questions: { orderBy: { position: "asc" } } },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const eventType = await owned(user.id, (await params).id);
  if (!eventType) return notFound("No such event type.");

  return ok({ eventType });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const { id } = await params;
  const parsed = await parseBody(request, eventTypeInput);
  if (!parsed.ok) return parsed.response;

  const result = await updateEventTypeFor(user.id, id, parsed.data);
  if (!result.ok) return notFound("No such event type.");

  return ok({ eventType: await owned(user.id, id) });
}

/**
 * Removes the event type, or retires it when bookings reference it.
 *
 * `archived: true` in the response is the difference, and the client should say
 * so — "hidden from your page" is a different promise from "gone".
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const result = await removeEventType(user.id, (await params).id);
  if (!result.ok) return notFound("No such event type.");

  return ok({ archived: result.archived });
}
