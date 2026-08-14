import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { setBookingStatusInput } from "@/lib/api/contracts";
import { notFound, ok, parseBody, unauthorized } from "@/lib/api/respond";
import { getHostBooking } from "@/lib/bookings/queries";
import { setBookingStatusForHost } from "@/lib/bookings/service";

/** Approve, decline, or cancel a booking as its host. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const { uid } = await params;
  const parsed = await parseBody(
    request,
    setBookingStatusInput.omit({ uid: true }),
  );
  if (!parsed.ok) return parsed.response;

  const result = await setBookingStatusForHost(user.id, {
    uid,
    status: parsed.data.status,
  });
  if (!result.ok) return notFound("No such booking.");

  return ok({ booking: await getHostBooking(user.id, uid) });
}
