/**
 * The origin this app is reachable at.
 *
 * Every shareable link is built from this: booking pages, meeting URLs, OAuth
 * redirect URIs, and every link inside an email. Getting it wrong doesn't fail
 * loudly — it produces a deployed app whose emails point at `localhost:3000`,
 * which only shows up once somebody clicks.
 *
 * Resolution order:
 *  1. `NEXT_PUBLIC_APP_URL` — **set this in production.** It is the only source
 *     that is guaranteed to be present and correct.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` — a convenience, not a guarantee. Vercel
 *     only injects it when a project has "Automatically expose System
 *     Environment Variables" enabled, and it was absent on the first deploy of
 *     this project, which silently produced `localhost` meeting links. Treat it
 *     as a nicety that saves a variable when it happens to be there.
 *  3. localhost, for development.
 *
 * `VERCEL_URL` is deliberately not consulted: it is unique per deployment, so a
 * link built from it would 404 as soon as that deployment was superseded — which
 * is worse than localhost, because it would look correct at send time.
 */
export function appUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  return "http://localhost:3000";
}

/** `appUrl()` without the scheme, for display next to a booking handle. */
export function appHost(): string {
  return appUrl().replace(/^https?:\/\//, "");
}
