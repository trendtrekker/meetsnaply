import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { ok, unauthorized } from "@/lib/api/respond";
import { isBookingTab, listBookings } from "@/lib/bookings/queries";

/**
 * The host's bookings for one tab.
 *
 * `?tab=` takes the same four values the dashboard uses, and an unrecognised
 * one falls back to "upcoming" rather than erroring — the same forgiving
 * behaviour the web page has for a hand-edited query string.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const raw = request.nextUrl.searchParams.get("tab");
  const tab = isBookingTab(raw) ? raw : "upcoming";

  const bookings = await listBookings(user.id, tab);
  return ok({ tab, bookings });
}
