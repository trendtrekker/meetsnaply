import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, MapPin, Mic, Video } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { setBookingStatus } from "@/lib/bookings/actions";
import { pipelineJobsForBooking } from "@/lib/jobs/actions";
import { PipelinePanel } from "@/components/dashboard/pipeline-panel";
import { describeLocation } from "@/lib/bookings/locations";
import { formatDateTime, zoneAbbreviation } from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";

interface PageProps {
  params: Promise<{ uid: string }>;
}

export default async function BookingDetailPage({ params }: PageProps) {
  const user = await requireUser();
  const { uid } = await params;

  const booking = await db.booking.findFirst({
    where: { uid, hostId: user.id },
    include: {
      eventType: { select: { title: true, slug: true } },
      attendees: { orderBy: { isGuest: "asc" } },
      answers: true,
      recap: { include: { deliveries: true } },
      recording: { include: { transcript: { include: { segments: true } } } },
    },
  });

  if (!booking) notFound();

  const pipelineJobs = await pipelineJobsForBooking(booking.id);

  const durationMinutes = Math.round(
    (booking.endTime.getTime() - booking.startTime.getTime()) / 60000,
  );
  const transcript = booking.recording?.transcript ?? null;
  const actionItems = Array.isArray(booking.recap?.actionItems)
    ? (booking.recap.actionItems as { text?: string; owner?: string }[])
    : [];

  return (
    <>
      <Link
        href="/dashboard"
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="size-4" />
        All bookings
      </Link>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-xl">
                    {booking.eventType.title}
                  </CardTitle>
                  <p className="mt-1 text-sm text-text-muted">
                    {booking.title}
                  </p>
                </div>
                <Badge
                  tone={
                    booking.status === "CONFIRMED"
                      ? "success"
                      : booking.status === "PENDING"
                        ? "warning"
                        : "danger"
                  }
                >
                  {booking.status.toLowerCase()}
                </Badge>
              </div>
            </CardHeader>

            <CardBody className="space-y-4 text-sm">
              <p className="flex items-start gap-3">
                <Calendar className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span>
                  {formatDateTime(booking.startTime, user.timeZone)}
                  <span className="block text-text-muted">
                    {formatDuration(durationMinutes)} ·{" "}
                    {zoneAbbreviation(booking.startTime, user.timeZone)} ·
                    invitee booked in {booking.timeZone}
                  </span>
                </span>
              </p>

              <p className="flex items-start gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-text-muted" />
                <span>
                  {describeLocation(
                    booking.locationType,
                    booking.locationValue,
                    booking.meetingUrl,
                  )}
                </span>
              </p>

              {booking.cancelReason ? (
                <p className="rounded-panel bg-danger/10 px-3.5 py-2.5 text-danger">
                  {booking.cancelReason}
                </p>
              ) : null}

              {booking.meetingUrl &&
              booking.status === "CONFIRMED" &&
              booking.endTime > new Date() ? (
                <a href={booking.meetingUrl} className="inline-block">
                  <Button type="button" size="sm">
                    <Video className="size-4" />
                    Join meeting
                  </Button>
                </a>
              ) : null}
            </CardBody>
          </Card>

          {booking.answers.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Answers</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="space-y-3 text-sm">
                  {booking.answers.map((answer) => (
                    <div key={answer.id}>
                      <dt className="text-xs font-bold tracking-wide text-text-muted uppercase">
                        {answer.label}
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-wrap">
                        {answer.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          ) : null}

          {/* ------------------ recap + transcript ------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="size-4 text-primary" />
                Recap &amp; transcript
              </CardTitle>
            </CardHeader>
            <CardBody>
              {booking.recap ? (
                <div className="space-y-4 text-sm">
                  <p className="whitespace-pre-wrap">{booking.recap.summary}</p>

                  {booking.recap.decisions.length > 0 ? (
                    <div>
                      <h3 className="mb-1.5 text-xs font-bold tracking-wide text-text-muted uppercase">
                        Decisions
                      </h3>
                      <ul className="list-inside list-disc space-y-1">
                        {booking.recap.decisions.map((decision) => (
                          <li key={decision}>{decision}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {actionItems.length > 0 ? (
                    <div>
                      <h3 className="mb-1.5 text-xs font-bold tracking-wide text-text-muted uppercase">
                        Action items
                      </h3>
                      <ul className="space-y-1.5">
                        {actionItems.map((item, index) => (
                          <li key={index} className="flex gap-2">
                            <span className="text-primary">→</span>
                            <span>
                              {item.text}
                              {item.owner ? (
                                <span className="text-text-muted">
                                  {" "}
                                  · {item.owner}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="text-xs text-text-muted">
                    {booking.recap.sentAt
                      ? `Emailed ${formatDateTime(booking.recap.sentAt, user.timeZone)}.`
                      : "Not yet sent to attendees."}
                    {booking.recap.inputTokens
                      ? ` · ${booking.recap.inputTokens.toLocaleString()} in / ${booking.recap.outputTokens?.toLocaleString()} out tokens`
                      : null}
                  </p>

                  {booking.recap.deliveries.length > 0 ? (
                    <ul className="space-y-1 text-xs">
                      {booking.recap.deliveries.map((delivery) => (
                        <li
                          key={delivery.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{delivery.email}</span>
                          {delivery.sentAt ? (
                            <Badge tone="success">sent</Badge>
                          ) : (
                            <Badge tone="danger" title={delivery.error ?? ""}>
                              failed
                            </Badge>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-text-muted">
                  {booking.recording
                    ? `Recording status: ${booking.recording.status.toLowerCase()}. The recap is generated once the call ends.`
                    : "Recording is off for this meeting type, so there is no transcript."}
                </p>
              )}

              {transcript && transcript.segments.length > 0 ? (
                <details className="mt-5">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">
                    Full transcript ({transcript.segments.length} segments)
                  </summary>
                  <div className="scrollbar-thin mt-3 max-h-96 space-y-3 overflow-y-auto pr-2">
                    {transcript.segments.map((segment) => (
                      <p key={segment.id} className="text-sm">
                        <span className="font-bold text-text-muted">
                          {segment.speaker}
                        </span>
                        <span className="ml-2 text-xs text-text-muted">
                          {Math.floor(segment.startMs / 60000)}:
                          {String(
                            Math.floor((segment.startMs % 60000) / 1000),
                          ).padStart(2, "0")}
                        </span>
                        <span className="mt-0.5 block">{segment.text}</span>
                      </p>
                    ))}
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>
        </div>

        {/* ------------------ sidebar ------------------ */}
        <aside className="space-y-5">
          <PipelinePanel
            jobs={pipelineJobs}
            bookingUid={booking.uid}
            timeZone={user.timeZone}
            hasRecording={Boolean(booking.recording)}
          />
          <Card>
            <CardHeader>
              <CardTitle>Attendees</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-3">
                <li className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-xs font-bold text-primary-fg">
                    {user.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {user.name}
                    </span>
                    <span className="block truncate text-xs text-text-muted">
                      {user.email}
                    </span>
                  </span>
                  <Badge tone="brand">host</Badge>
                </li>

                {booking.attendees.map((attendee) => (
                  <li key={attendee.id} className="flex items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-bold">
                      {attendee.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {attendee.name}
                      </span>
                      <span className="block truncate text-xs text-text-muted">
                        {attendee.email}
                      </span>
                    </span>
                    <Badge
                      tone={
                        attendee.status === "ACCEPTED"
                          ? "success"
                          : attendee.status === "DECLINED"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {attendee.status === "NEEDS_ACTION"
                        ? "pending"
                        : attendee.status.toLowerCase().replace("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {booking.status === "PENDING" ? (
            <Card>
              <CardHeader>
                <CardTitle>Approve request</CardTitle>
              </CardHeader>
              <CardBody className="flex gap-2">
                <form action={setBookingStatus} className="flex-1">
                  <input type="hidden" name="uid" value={booking.uid} />
                  <input type="hidden" name="status" value="CONFIRMED" />
                  <Button type="submit" size="sm" fullWidth>
                    Confirm
                  </Button>
                </form>
                <form action={setBookingStatus} className="flex-1">
                  <input type="hidden" name="uid" value={booking.uid} />
                  <input type="hidden" name="status" value="REJECTED" />
                  <Button type="submit" size="sm" variant="secondary" fullWidth>
                    Decline
                  </Button>
                </form>
              </CardBody>
            </Card>
          ) : null}

          {booking.status !== "CANCELLED" && booking.status !== "REJECTED" ? (
            <form action={setBookingStatus}>
              <input type="hidden" name="uid" value={booking.uid} />
              <input type="hidden" name="status" value="CANCELLED" />
              <Button type="submit" variant="ghost" fullWidth>
                Cancel this booking
              </Button>
            </form>
          ) : null}
        </aside>
      </div>
    </>
  );
}
