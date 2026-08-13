import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, MapPin } from "lucide-react";
import { getAvailableSlots, getBookableEventType } from "@/lib/availability";
import { BookingFlow } from "@/components/booking/booking-flow";
import { Logo } from "@/components/brand/logo";
import { LOCATION_LABELS } from "@/lib/bookings/locations";
import { formatDuration } from "@/lib/utils";
import { monthKey, parseMonthKey } from "@/lib/datetime";

interface PageProps {
  params: Promise<{ username: string; slug: string }>;
  searchParams: Promise<{ month?: string; reschedule?: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username, slug } = await params;
  const eventType = await getBookableEventType(username, slug);
  if (!eventType) return { title: "Not found · meetsnaply" };
  return {
    title: `${eventType.title} · ${eventType.user.name}`,
    description: eventType.description ?? undefined,
  };
}

export default async function BookingPage({ params, searchParams }: PageProps) {
  const { username, slug } = await params;
  const { month, reschedule } = await searchParams;

  const eventType = await getBookableEventType(username, slug);
  if (!eventType) notFound();

  const now = new Date();
  const currentMonth = month ?? monthKey(now, eventType.user.timeZone);
  const { year, month: monthIndex } = parseMonthKey(currentMonth, now);

  // Pad a day either side so slots near a month boundary appear once the
  // invitee's timezone shifts them across it.
  const from = new Date(Date.UTC(year, monthIndex, 1, 0, 0));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0));
  const { slots, externalBusyComplete } = await getAvailableSlots({
    eventType,
    from: new Date(from.getTime() - 86_400_000),
    to: new Date(to.getTime() + 86_400_000),
    now,
    excludeBookingId: undefined,
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-10">
      <div className="rounded-card border border-border bg-surface p-6 md:p-8">
        <header className="border-b border-border pb-6">
          <Link
            href={`/${username}`}
            className="text-sm font-semibold text-text-muted transition-colors hover:text-text"
          >
            {eventType.user.name}
          </Link>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">
            {eventType.title}
          </h1>
          {eventType.description ? (
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {eventType.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-text-muted">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" />
              {formatDuration(eventType.durationMinutes)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-4" />
              {LOCATION_LABELS[eventType.locationType]}
            </span>
          </div>
        </header>

        <div className="pt-6">
          {reschedule ? (
            <p className="mb-5 rounded-panel bg-primary-soft px-4 py-3 text-sm font-semibold text-primary">
              Pick a new time. Your original booking is released once you
              confirm.
            </p>
          ) : null}

          {!externalBusyComplete ? (
            <p className="mb-5 rounded-panel bg-warning/10 px-4 py-3 text-sm text-warning">
              We couldn&apos;t reach {eventType.user.name}&apos;s calendar just
              now, so some of these times may already be taken. Your booking is
              re-checked before it&apos;s confirmed.
            </p>
          ) : null}

          <BookingFlow
            username={username}
            slug={slug}
            title={eventType.title}
            durationMinutes={eventType.durationMinutes}
            locationLabel={LOCATION_LABELS[eventType.locationType]}
            month={currentMonth}
            slots={slots.map((slot) => slot.toISOString())}
            initialTimeZone={eventType.user.timeZone}
            questions={eventType.questions.map((question) => ({
              id: question.id,
              identifier: question.identifier,
              label: question.label,
              helpText: question.helpText,
              type: question.type,
              required: question.required,
              options: question.options,
            }))}
            recordingEnabled={eventType.recordingEnabled}
            transcriptionEnabled={eventType.transcriptionEnabled}
            sendRecapToAttendees={eventType.sendRecapToAttendees}
            rescheduleOf={reschedule}
          />
        </div>
      </div>

      <footer className="mt-auto pt-10 text-center">
        <Link href="/" className="inline-block opacity-50 transition-opacity hover:opacity-100">
          <Logo className="text-sm" />
        </Link>
      </footer>
    </main>
  );
}
