import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Calendar, Check, MapPin, Mic, Users, X } from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cancelBooking } from "@/lib/bookings/actions";
import { describeLocation } from "@/lib/bookings/locations";
import { formatDateTime, zoneAbbreviation } from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";

export const metadata: Metadata = { title: "Your booking · meetsnaply" };

interface PageProps {
  params: Promise<{ uid: string }>;
}

export default async function BookingConfirmationPage({ params }: PageProps) {
  const { uid } = await params;

  const booking = await db.booking.findUnique({
    where: { uid },
    include: {
      host: { select: { name: true, username: true } },
      eventType: {
        select: {
          slug: true,
          durationMinutes: true,
          transcriptionEnabled: true,
          sendRecapToAttendees: true,
        },
      },
      attendees: { orderBy: { isGuest: "asc" } },
    },
  });

  if (!booking) notFound();

  const cancelled =
    booking.status === "CANCELLED" || booking.status === "REJECTED";
  const invitee = booking.attendees.find((a) => !a.isGuest);
  const displayZone = booking.timeZone;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-12">
      <div className="rounded-card border border-border bg-surface p-7">
        <div
          className={`grid size-12 place-items-center rounded-full ${
            cancelled ? "bg-danger/15 text-danger" : "bg-primary text-primary-fg"
          }`}
        >
          {cancelled ? <X className="size-6" /> : <Check className="size-6" />}
        </div>

        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          {cancelled
            ? "This booking is cancelled"
            : booking.status === "PENDING"
              ? "Waiting for confirmation"
              : "You're booked"}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {cancelled
            ? booking.cancelReason
              ? `Reason: ${booking.cancelReason}`
              : "The time has been released."
            : booking.status === "PENDING"
              ? `${booking.host.name} still needs to approve this request. You'll get an email either way.`
              : "A calendar invitation is on its way to your inbox."}
        </p>

        <dl className="mt-6 space-y-4 border-t border-border pt-6 text-sm">
          <Row icon={<Calendar className="size-4" />} label="When">
            <span className={cancelled ? "line-through opacity-60" : ""}>
              {formatDateTime(booking.startTime, displayZone)}
            </span>
            <span className="block text-text-muted">
              {formatDuration(booking.eventType.durationMinutes)} ·{" "}
              {zoneAbbreviation(booking.startTime, displayZone)}
            </span>
          </Row>

          <Row icon={<MapPin className="size-4" />} label="Where">
            {booking.meetingUrl && !cancelled ? (
              <a
                href={booking.meetingUrl}
                className="font-semibold text-primary underline underline-offset-2"
              >
                {booking.meetingUrl}
              </a>
            ) : (
              describeLocation(
                booking.locationType,
                booking.locationValue,
                booking.meetingUrl,
              )
            )}
          </Row>

          <Row icon={<Users className="size-4" />} label="Who">
            <ul className="space-y-1">
              <li>{booking.host.name} (host)</li>
              {booking.attendees.map((attendee) => (
                <li key={attendee.id}>
                  {attendee.name}
                  {attendee.isGuest ? (
                    <span className="text-text-muted"> · guest</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Row>

          {booking.eventType.transcriptionEnabled ? (
            <Row icon={<Mic className="size-4" />} label="Recording">
              <Badge tone="brand">Transcribed</Badge>
              <p className="mt-1.5 text-text-muted">
                {booking.eventType.sendRecapToAttendees
                  ? "Everyone on the call gets a summary, action items, and the full transcript by email afterwards."
                  : "The host receives a transcript after the call."}
              </p>
            </Row>
          ) : null}
        </dl>

        {!cancelled ? (
          <div className="mt-6 space-y-3 border-t border-border pt-6">
            <Link
              href={`/${booking.host.username}/${booking.eventType.slug}?reschedule=${booking.uid}`}
              className="block"
            >
              <Button variant="secondary" fullWidth type="button">
                Reschedule
              </Button>
            </Link>

            <form action={cancelBooking} className="space-y-2">
              <input type="hidden" name="uid" value={booking.uid} />
              <Input
                name="reason"
                placeholder="Reason for cancelling (optional)"
                aria-label="Reason for cancelling"
              />
              <Button variant="ghost" fullWidth type="submit">
                Cancel booking
              </Button>
            </form>
          </div>
        ) : (
          <Link
            href={`/${booking.host.username}`}
            className="mt-6 block border-t border-border pt-6"
          >
            <Button variant="secondary" fullWidth type="button">
              Book another time
            </Button>
          </Link>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-text-muted">
        {invitee?.email ? `Confirmation sent to ${invitee.email}` : null}
      </p>

      <footer className="mt-auto pt-10 text-center">
        <Link href="/" className="inline-block opacity-50 transition-opacity hover:opacity-100">
          <Logo className="text-sm" />
        </Link>
      </footer>
    </main>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-bold tracking-wide text-text-muted uppercase">
          {label}
        </dt>
        <dd className="mt-0.5 font-medium">{children}</dd>
      </div>
    </div>
  );
}
