import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { EventTypeForm } from "@/components/dashboard/event-type-form";
import { deleteEventType, updateEventType } from "@/lib/event-types/actions";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditEventTypePage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const [eventType, schedules] = await Promise.all([
    db.eventType.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { bookings: true } } },
    }),
    db.schedule.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, timeZone: true },
    }),
  ]);

  if (!eventType) notFound();

  const publicUrl = `${origin}/${user.username}/${eventType.slug}`;

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/event-types"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="size-4" />
        Meeting types
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold tracking-tight">
            {eventType.title}
          </h1>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-primary"
          >
            {publicUrl.replace(/^https?:\/\//, "")}
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </header>

      <EventTypeForm
        action={updateEventType}
        schedules={schedules}
        bookingBaseUrl={`${origin}/${user.username}`}
        submitLabel="Save changes"
        values={{
          id: eventType.id,
          slug: eventType.slug,
          title: eventType.title,
          description: eventType.description ?? "",
          durationMinutes: eventType.durationMinutes,
          slotIntervalMinutes: eventType.slotIntervalMinutes,
          bufferBeforeMinutes: eventType.bufferBeforeMinutes,
          bufferAfterMinutes: eventType.bufferAfterMinutes,
          minimumNoticeMinutes: eventType.minimumNoticeMinutes,
          bookingHorizonDays: eventType.bookingHorizonDays,
          maxBookingsPerDay: eventType.maxBookingsPerDay,
          reminderMinutes: eventType.reminderMinutes,
          locationType: eventType.locationType,
          locationValue: eventType.locationValue ?? "",
          scheduleId: eventType.scheduleId,
          isActive: eventType.isActive,
          isPrivate: eventType.isPrivate,
          requiresConfirmation: eventType.requiresConfirmation,
          recordingEnabled: eventType.recordingEnabled,
          transcriptionEnabled: eventType.transcriptionEnabled,
          sendRecapToAttendees: eventType.sendRecapToAttendees,
        }}
      />

      <form
        action={deleteEventType}
        className="mt-6 flex items-center justify-between gap-4 rounded-card border border-border px-5 py-4"
      >
        <input type="hidden" name="id" value={eventType.id} />
        <p className="text-sm text-text-muted">
          {eventType._count.bookings > 0
            ? `${eventType._count.bookings} booking(s) reference this type, so it will be archived rather than deleted.`
            : "This type has no bookings and will be deleted permanently."}
        </p>
        <Button type="submit" variant="ghost" size="sm" className="shrink-0">
          {eventType._count.bookings > 0 ? "Archive" : "Delete"}
        </Button>
      </form>
    </div>
  );
}
