import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { notFound, ok, unauthorized } from "@/lib/api/respond";
import { deleteDateOverride } from "@/lib/availability/schedule-service";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const result = await deleteDateOverride(user.id, (await params).id);
  if (!result.ok) return notFound("No such override.");

  return ok({ deleted: true });
}
