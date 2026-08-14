import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/api/auth";
import { notFound, ok, unauthorized } from "@/lib/api/respond";
import { getHostBooking } from "@/lib/bookings/queries";
import { pipelineJobsForBooking } from "@/lib/jobs/pipeline-service";

/**
 * One booking the caller hosts, with its recap-pipeline jobs.
 *
 * The jobs come along rather than living behind a second request: the detail
 * screen always shows them, and a phone on a slow connection should not need
 * two round trips to render one view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> },
) {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const { uid } = await params;
  const booking = await getHostBooking(user.id, uid);
  if (!booking) return notFound("No such booking.");

  const jobs = await pipelineJobsForBooking(booking.id);
  return ok({ booking, jobs });
}
