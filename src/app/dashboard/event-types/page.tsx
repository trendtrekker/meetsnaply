import Link from "next/link";
import { Clock, EyeOff, Mic, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LOCATION_LABELS } from "@/lib/bookings/locations";
import { formatDuration } from "@/lib/utils";
import { appUrl } from "@/lib/app-url";

export default async function EventTypesPage() {
  const user = await requireUser();
  const origin = appUrl();

  const eventTypes = await db.eventType.findMany({
    where: { userId: user.id },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { bookings: true } } },
  });

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            Meeting types
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Each one gets its own link you can share.
          </p>
        </div>
        <Link href="/dashboard/event-types/new">
          <Button type="button">
            <Plus className="size-4" />
            New type
          </Button>
        </Link>
      </header>

      {eventTypes.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-bold">No meeting types yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
            Create one and share the link — bookings appear on your dashboard.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {eventTypes.map((eventType) => (
            <li key={eventType.id}>
              <Link
                href={`/dashboard/event-types/${eventType.id}`}
                className="flex h-full flex-col rounded-card border border-border bg-surface p-5 transition-colors hover:border-primary"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{eventType.title}</p>
                  {!eventType.isActive ? (
                    <Badge tone="neutral">Off</Badge>
                  ) : null}
                </div>

                <p className="mt-1 truncate text-xs text-text-muted">
                  {origin.replace(/^https?:\/\//, "")}/{user.username}/
                  {eventType.slug}
                </p>

                {eventType.description ? (
                  <p className="mt-2 line-clamp-2 text-sm text-text-muted">
                    {eventType.description}
                  </p>
                ) : null}

                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                  <Badge>
                    <Clock className="size-3" />
                    {formatDuration(eventType.durationMinutes)}
                  </Badge>
                  <Badge>{LOCATION_LABELS[eventType.locationType]}</Badge>
                  {eventType.transcriptionEnabled ? (
                    <Badge tone="brand">
                      <Mic className="size-3" />
                      Transcribed
                    </Badge>
                  ) : null}
                  {eventType.isPrivate ? (
                    <Badge>
                      <EyeOff className="size-3" />
                      Hidden
                    </Badge>
                  ) : null}
                  {eventType._count.bookings > 0 ? (
                    <Badge>{eventType._count.bookings} booked</Badge>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
