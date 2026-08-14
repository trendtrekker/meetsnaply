import { useMutation, useQueryClient } from "@tanstack/react-query";

import { request } from "@/api/client";
import type { BookingDetailResponse, BookingStatus } from "@/api/types";

/**
 * Writes, and what they invalidate.
 *
 * Every one of these changes something two other screens are already showing:
 * approving a request empties the unconfirmed tab and fills the upcoming one,
 * and both counts on the home screen move. Rather than patch caches by hand,
 * each mutation invalidates the queries it could have affected and lets them
 * refetch — the lists are small, the server is the authority, and a wrong
 * optimistic guess about a booking is worse than a brief spinner.
 */

/** Everything that could show a booking, or a count derived from one. */
function invalidateBookingViews(
  queryClient: ReturnType<typeof useQueryClient>,
  uid: string,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["booking", uid] }),
    queryClient.invalidateQueries({ queryKey: ["bookings"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

export function useSetBookingStatus(uid: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (status: BookingStatus) =>
      request<{ booking: BookingDetailResponse["booking"] }>(
        `/bookings/${uid}/status`,
        { method: "POST", body: { status } },
      ),
    onSuccess: () => invalidateBookingViews(queryClient, uid),
  });
}

export function useRetryPipelineJob(uid: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (jobId: string) =>
      request<{ retried: boolean }>(`/pipeline/jobs/${jobId}/retry`, {
        method: "POST",
      }),
    // The job list lives on the booking detail response, so that is what has
    // to come back — the retry itself returns only an acknowledgement.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["booking", uid] }),
  });
}

export function useReprocessRecording(uid: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      request<{ queued: boolean }>(`/pipeline/bookings/${uid}/reprocess`, {
        method: "POST",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["booking", uid] }),
  });
}
