import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { ok, unauthorized } from "@/lib/api/respond";
import { countUnconfirmed, listBookings } from "@/lib/bookings/queries";

/**
 * Everything the home screen shows, in one request.
 *
 * The web dashboard fetches its tab and its unconfirmed badge together; this
 * does the same, so a phone opening the app renders a complete screen from a
 * single round trip rather than three.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const now = new Date();
  const [upcoming, unconfirmedCount] = await Promise.all([
    listBookings(user.id, "upcoming", now, 10),
    countUnconfirmed(user.id, now),
  ]);

  return ok({ user, upcoming, unconfirmedCount });
}
