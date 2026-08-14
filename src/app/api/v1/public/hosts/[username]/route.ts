import type { NextRequest } from "next/server";
import { notFound, ok } from "@/lib/api/respond";
import { db } from "@/lib/db";

/**
 * A host's public page: who they are and what can be booked.
 *
 * Private and inactive event types are excluded here rather than filtered by
 * the client — an unlisted booking link should not be discoverable by reading
 * a JSON response.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;

  const host = await db.user.findUnique({
    where: { username },
    select: {
      name: true,
      username: true,
      avatarUrl: true,
      bio: true,
      timeZone: true,
      brandColor: true,
      eventTypes: {
        where: { isActive: true, isPrivate: false },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          slug: true,
          title: true,
          description: true,
          durationMinutes: true,
          locationType: true,
          recordingEnabled: true,
          transcriptionEnabled: true,
        },
      },
    },
  });

  if (!host) return notFound("No such host.");

  return ok({ host });
}
