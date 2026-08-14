import type { NextRequest } from "next/server";
import { bookSlotInput } from "@/lib/api/contracts";
import { fail, ok, parseBody } from "@/lib/api/respond";
import { getPublicBooking } from "@/lib/bookings/queries";
import { bookSlot } from "@/lib/bookings/service";

/**
 * Books a slot. Public by design — this is what an invitee does.
 *
 * A refusal is not always the client's fault: the slot may have been taken
 * between listing and booking, which is a 409 rather than a validation error,
 * because retrying the same request will never succeed but picking another slot
 * will.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, bookSlotInput);
  if (!parsed.ok) return parsed.response;

  const result = await bookSlot(parsed.data);

  if (!result.ok) {
    if (result.fieldErrors) {
      return fail(
        "invalid_request",
        "Some fields need attention.",
        result.fieldErrors,
      );
    }
    return fail("conflict", result.error ?? "That booking could not be made.");
  }

  return ok({ booking: await getPublicBooking(result.uid) }, 201);
}
