import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Clock, Mic } from "lucide-react";
import { db } from "@/lib/db";
import { Logo } from "@/components/brand/logo";
import { Badge } from "@/components/ui/badge";
import { LOCATION_LABELS } from "@/lib/bookings/locations";
import { formatDuration } from "@/lib/utils";

interface PageProps {
  params: Promise<{ username: string }>;
}

async function loadProfile(username: string) {
  return db.user.findUnique({
    where: { username },
    select: {
      name: true,
      username: true,
      bio: true,
      avatarUrl: true,
      eventTypes: {
        where: { isActive: true, isPrivate: false },
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          durationMinutes: true,
          locationType: true,
          transcriptionEnabled: true,
        },
      },
    },
  });
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) return { title: "Not found · meetsnaply" };
  return {
    title: `Book with ${profile.name} · meetsnaply`,
    description: profile.bio ?? `Schedule a meeting with ${profile.name}.`,
  };
}

export default async function ProfilePage({ params }: PageProps) {
  const { username } = await params;
  const profile = await loadProfile(username);
  if (!profile) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 py-12">
      <header className="text-center">
        <div className="mx-auto grid size-16 place-items-center rounded-full bg-surface-inverted text-2xl font-extrabold text-text-inverted">
          {profile.name.slice(0, 1).toUpperCase()}
        </div>
        <h1 className="mt-4 text-2xl font-extrabold tracking-tight">
          {profile.name}
        </h1>
        {profile.bio ? (
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-muted">
            {profile.bio}
          </p>
        ) : null}
      </header>

      <section className="mt-8 space-y-3">
        <h2 className="sr-only">Meeting types</h2>
        {profile.eventTypes.length === 0 ? (
          <p className="rounded-card border border-dashed border-border-strong px-6 py-10 text-center text-sm text-text-muted">
            {profile.name} has no public meeting types right now.
          </p>
        ) : (
          profile.eventTypes.map((eventType) => (
            <Link
              key={eventType.id}
              href={`/${profile.username}/${eventType.slug}`}
              className="group flex items-center gap-4 rounded-card border border-border bg-surface px-5 py-4 transition-colors hover:border-primary"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{eventType.title}</p>
                {eventType.description ? (
                  <p className="mt-0.5 line-clamp-2 text-sm text-text-muted">
                    {eventType.description}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                </div>
              </div>
              <ArrowRight className="size-5 shrink-0 text-text-muted transition-colors group-hover:text-primary" />
            </Link>
          ))
        )}
      </section>

      <footer className="mt-auto pt-12 text-center">
        <Link href="/" className="inline-block opacity-50 transition-opacity hover:opacity-100">
          <Logo className="text-sm" />
        </Link>
      </footer>
    </main>
  );
}
