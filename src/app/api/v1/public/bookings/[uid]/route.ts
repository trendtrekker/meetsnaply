import type { NextRequest } from "next/server";
import { notFound, ok } from "@/lib/api/respond";
import { getPublicBooking } from "@/lib/bookings/queries";

/**
 * A booking by its public uid — the confirmation screen.
 *
 * The uid is the capability, exactly as it is for the emailed link: anyone
 * holding it may read the booking, and it carries no host-only fields.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  const booking = await getPublicBooking((await params).uid);
  if (!booking) return notFound("No such booking.");

  return ok({ booking });
}
