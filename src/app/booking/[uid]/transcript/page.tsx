import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Mic } from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/datetime";

export const metadata: Metadata = {
  title: "Transcript · meetsnaply",
  // Meeting content should not end up in a search index.
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ uid: string }>;
}

function timestamp(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { uid } = await params;

  // Reachable by anyone holding the booking's unguessable uid — the same
  // capability model as the reschedule and cancel links in the same emails.
  const booking = await db.booking.findUnique({
    where: { uid },
    include: {
      host: { select: { name: true } },
      eventType: { select: { title: true } },
      recap: true,
      recording: {
        include: {
          transcript: {
            include: { segments: { orderBy: { startMs: "asc" } } },
          },
        },
      },
    },
  });

  if (!booking) notFound();

  const transcript = booking.recording?.transcript ?? null;
  const actionItems = Array.isArray(booking.recap?.actionItems)
    ? (booking.recap.actionItems as {
        text: string;
        owner: string | null;
        due: string | null;
      }[])
    : [];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <Link
        href={`/booking/${uid}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="size-4" />
        Back to booking
      </Link>

      <header className="rounded-card border border-border bg-surface p-6">
        <h1 className="text-2xl font-extrabold tracking-tight">
          {booking.eventType.title}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          {formatDateTime(booking.startTime, booking.timeZone)} · hosted by{" "}
          {booking.host.name}
        </p>

        {booking.recap ? (
          <div className="mt-5 space-y-4 border-t border-border pt-5 text-sm">
            <p className="leading-relaxed">{booking.recap.summary}</p>

            {booking.recap.decisions.length > 0 ? (
              <div>
                <h2 className="mb-1.5 text-xs font-bold tracking-wide text-text-muted uppercase">
                  Decisions
                </h2>
                <ul className="list-inside list-disc space-y-1">
                  {booking.recap.decisions.map((decision) => (
                    <li key={decision}>{decision}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {actionItems.length > 0 ? (
              <div>
                <h2 className="mb-1.5 text-xs font-bold tracking-wide text-text-muted uppercase">
                  Action items
                </h2>
                <ul className="space-y-1.5">
                  {actionItems.map((item, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-primary">→</span>
                      <span>
                        {item.text}
                        {item.owner ? (
                          <span className="text-text-muted"> · {item.owner}</span>
                        ) : null}
                        {item.due ? (
                          <span className="text-text-muted"> · due {item.due}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {booking.recap.openQuestions.length > 0 ? (
              <div>
                <h2 className="mb-1.5 text-xs font-bold tracking-wide text-text-muted uppercase">
                  Open questions
                </h2>
                <ul className="list-inside list-disc space-y-1">
                  {booking.recap.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      <section className="mt-5 rounded-card border border-border bg-surface p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <Mic className="size-4 text-primary" />
            Transcript
          </h2>
          {transcript?.status === "READY" ? (
            <Badge>{transcript.language.toUpperCase()}</Badge>
          ) : null}
        </div>

        {!transcript || transcript.status !== "READY" ? (
          <p className="mt-4 text-sm text-text-muted">
            {transcript?.status === "FAILED"
              ? "Transcription failed for this meeting."
              : transcript
                ? "The transcript is still being generated. Check back shortly."
                : "No transcript was recorded for this meeting."}
          </p>
        ) : transcript.segments.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">
            The recording contained no speech.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {transcript.segments.map((segment) => (
              <div key={segment.id} className="text-sm">
                <p className="flex items-baseline gap-2">
                  <span className="font-bold">{segment.speaker}</span>
                  <span className="text-xs text-text-muted">
                    {timestamp(segment.startMs)}
                  </span>
                </p>
                <p className="mt-0.5 leading-relaxed">{segment.text}</p>
              </div>
            ))}
          </div>
        )}

        {booking.recording?.purgedAt ? (
          <p className="mt-6 border-t border-border pt-4 text-xs text-text-muted">
            The audio for this meeting was deleted on{" "}
            {booking.recording.purgedAt.toISOString().slice(0, 10)}. This
            transcript is what remains.
          </p>
        ) : booking.recording?.expiresAt ? (
          <p className="mt-6 border-t border-border pt-4 text-xs text-text-muted">
            The audio is scheduled for deletion on{" "}
            {booking.recording.expiresAt.toISOString().slice(0, 10)}.
          </p>
        ) : null}
      </section>

      <footer className="mt-auto pt-10 text-center">
        <Link href="/" className="inline-block opacity-50 transition-opacity hover:opacity-100">
          <Logo className="text-sm" />
        </Link>
      </footer>
    </main>
  );
}
