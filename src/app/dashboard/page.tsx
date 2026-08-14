import Link from "next/link";
import { Mic, Users, Video } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDayMonth, formatTime } from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";
import {
  countUnconfirmed,
  listBookings,
  type BookingTab,
} from "@/lib/bookings/queries";

// The tab definitions and their queries are shared with /api/v1 so the native
// app and this page can never disagree about which meetings are "past".
type Tab = BookingTab;

const TABS: { key: Tab; label: string }[] = [
  { key: "upcoming", label: "Upcoming" },
  { key: "unconfirmed", label: "Unconfirmed" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === rawTab)
    ? (rawTab as Tab)
    : "upcoming";

  const now = new Date();

  const [bookings, counts] = await Promise.all([
    listBookings(user.id, tab, now),
    countUnconfirmed(user.id, now),
  ]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">
          Ciao, {user.name.split(" ")[0]}!
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          View your generated meetings schedule.
        </p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1.5">
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Link
              key={item.key}
              href={`/dashboard?tab=${item.key}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-fg"
                  : "bg-surface text-text-muted hover:bg-surface-muted hover:text-text"
              }`}
            >
              {item.label}
              {item.key === "unconfirmed" && counts > 0 ? (
                <span
                  className={`grid size-5 place-items-center rounded-full text-[0.625rem] font-bold ${
                    active ? "bg-primary-fg text-primary" : "bg-primary text-primary-fg"
                  }`}
                >
                  {counts}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {bookings.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-bold">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
            {tab === "upcoming"
              ? "Share your booking link and meetings will land here automatically."
              : `No ${tab} bookings.`}
          </p>
          {tab === "upcoming" ? (
            <Link
              href="/dashboard/event-types"
              className="mt-4 inline-block text-sm font-semibold text-primary hover:underline"
            >
              Set up a meeting type →
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-2.5">
          {bookings.map((booking) => {
            const cancelled =
              booking.status === "CANCELLED" || booking.status === "REJECTED";

            return (
              <li key={booking.id}>
                <Link
                  href={`/dashboard/bookings/${booking.uid}`}
                  className="flex gap-4 rounded-card border border-border bg-surface p-4 transition-colors hover:border-primary"
                >
                  <div
                    className={`flex w-16 shrink-0 flex-col items-center justify-center rounded-panel py-2 ${
                      cancelled
                        ? "bg-surface-muted text-text-muted"
                        : "bg-primary text-primary-fg"
                    }`}
                  >
                    <span className="text-base leading-none font-extrabold">
                      {formatTime(booking.startTime, user.timeZone)}
                    </span>
                    <span className="mt-1 text-[0.625rem] font-bold tracking-wide opacity-80">
                      {formatDayMonth(booking.startTime, user.timeZone)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={`truncate font-bold ${cancelled ? "line-through opacity-60" : ""}`}
                    >
                      {booking.eventType.title}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-text-muted">
                      {formatDateTime(booking.startTime, user.timeZone)} ·{" "}
                      {formatDuration(
                        Math.round(
                          (booking.endTime.getTime() -
                            booking.startTime.getTime()) /
                            60000,
                        ),
                      )}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge>
                        <Users className="size-3" />
                        {booking.attendees.length} attendee
                        {booking.attendees.length === 1 ? "" : "s"}
                      </Badge>
                      {booking.status === "PENDING" ? (
                        <Badge tone="warning">Pending</Badge>
                      ) : null}
                      {cancelled ? <Badge tone="danger">Cancelled</Badge> : null}
                      {booking.recap ? (
                        <Badge tone="success">
                          <Mic className="size-3" />
                          Recap ready
                        </Badge>
                      ) : booking.eventType.transcriptionEnabled ? (
                        <Badge tone="brand">
                          <Mic className="size-3" />
                          Transcribed
                        </Badge>
                      ) : null}
                      {booking.meetingUrl && !cancelled ? (
                        <Badge>
                          <Video className="size-3" />
                          Video
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
