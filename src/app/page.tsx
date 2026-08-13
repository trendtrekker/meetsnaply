import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Logo, Mark } from "@/components/brand/logo";
import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-6 py-10">
      <header className="flex justify-center">
        <Logo />
      </header>

      <div className="mt-10 grid aspect-4/3 place-items-center overflow-hidden rounded-card bg-ink-900">
        {/* Concentric arcs echo the reference art without needing an asset. */}
        <svg viewBox="0 0 200 150" className="size-full" aria-hidden="true">
          <defs>
            <radialGradient id="glow">
              <stop offset="0%" stopColor="var(--color-brand-400)" />
              <stop offset="100%" stopColor="var(--color-brand-600)" />
            </radialGradient>
          </defs>
          {[26, 40, 54, 68, 82].map((r) => (
            <circle
              key={r}
              cx="100"
              cy="75"
              r={r}
              fill="none"
              stroke="var(--color-ink-800)"
              strokeWidth="1.5"
            />
          ))}
          <g transform="translate(100 75) scale(1.4)">
            <path
              d="M0-20c1.1 9.1 9.8 17.8 20 20-10.2 2.2-18.9 10.9-20 20-1.1-9.1-9.8-17.8-20-20 10.2-2.2 18.9-10.9 20-20Z"
              fill="url(#glow)"
            />
          </g>
        </svg>
      </div>

      <h1 className="text-display mt-8 text-4xl">
        Generate a meeting from your audio &amp; video calls.
      </h1>
      <p className="mt-4 text-[0.9375rem] leading-relaxed text-text-muted">
        Share one link. Get booked in the right timezone. Everyone leaves with a
        transcript, a summary, and the action items — in zero seconds.
      </p>

      <div className="mt-8 space-y-3">
        <Link href="/signup" className="block">
          <Button size="lg" fullWidth type="button">
            Get Started
          </Button>
        </Link>
        <p className="text-center text-sm text-text-muted">
          Have account?{" "}
          <Link
            href="/login"
            className="font-semibold text-primary hover:underline"
          >
            Login
          </Link>
        </p>
      </div>

      <footer className="mt-auto flex items-center justify-center gap-2 pt-12 text-xs text-text-muted">
        <Mark className="size-3" />
        Scheduling, recording, and recaps in one place.
      </footer>
    </main>
  );
}
