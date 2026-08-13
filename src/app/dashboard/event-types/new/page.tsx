import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { EventTypeForm } from "@/components/dashboard/event-type-form";
import { createEventType } from "@/lib/event-types/actions";
import { appUrl } from "@/lib/app-url";

export default async function NewEventTypePage() {
  const user = await requireUser();
  const origin = appUrl();

  const schedules = await db.schedule.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timeZone: true },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        href="/dashboard/event-types"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="size-4" />
        Meeting types
      </Link>

      <h1 className="mb-6 text-3xl font-extrabold tracking-tight">
        New meeting type
      </h1>

      <EventTypeForm
        action={createEventType}
        schedules={schedules}
        bookingBaseUrl={`${origin}/${user.username}`}
        submitLabel="Create"
        values={{
          slug: "",
          title: "",
          description: "",
          durationMinutes: 30,
          slotIntervalMinutes: 15,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          minimumNoticeMinutes: 240,
          bookingHorizonDays: 60,
          maxBookingsPerDay: null,
          reminderMinutes: [1440, 60],
          locationType: "MEETSNAPLY_VIDEO",
          locationValue: "",
          scheduleId: schedules[0]?.id ?? null,
          isActive: true,
          isPrivate: false,
          requiresConfirmation: false,
          recordingEnabled: false,
          transcriptionEnabled: false,
          sendRecapToAttendees: false,
        }}
      />
    </div>
  );
}
