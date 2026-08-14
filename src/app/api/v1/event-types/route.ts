import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { eventTypeInput } from "@/lib/api/contracts";
import { ok, parseBody, unauthorized } from "@/lib/api/respond";
import { db } from "@/lib/db";
import { createEventTypeFor } from "@/lib/event-types/service";

export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const eventTypes = await db.eventType.findMany({
    where: { userId: user.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { bookings: true } } },
  });

  return ok({ eventTypes });
}

export async function POST(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const parsed = await parseBody(request, eventTypeInput);
  if (!parsed.ok) return parsed.response;

  const { id } = await createEventTypeFor(user.id, parsed.data);
  const eventType = await db.eventType.findUnique({ where: { id } });

  return ok({ eventType }, 201);
}
