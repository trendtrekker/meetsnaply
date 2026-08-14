import { z } from "zod";
import type { NextRequest } from "next/server";
import { notFound, ok, parseBody } from "@/lib/api/respond";
import { getPublicBooking } from "@/lib/bookings/queries";
import { cancelBookingByUid } from "@/lib/bookings/service";

const cancelInput = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * Invitee-side cancellation, authorised by holding the uid.
 *
 * An already-cancelled booking answers 404 rather than 200: the caller asked to
 * change something and nothing changed, and reporting success would let a
 * client show "cancelled" for a booking someone else had already cancelled for
 * a different reason.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  const { uid } = await params;

  const parsed = await parseBody(request, cancelInput);
  if (!parsed.ok) return parsed.response;

  const result = await cancelBookingByUid({ uid, reason: parsed.data.reason });
  if (!result.ok) return notFound("No such booking, or it was already cancelled.");

  return ok({ booking: await getPublicBooking(uid) });
}
