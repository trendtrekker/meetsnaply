/**
 * The origin this app is reachable at.
 *
 * Every shareable link is built from this: booking pages, meeting URLs, OAuth
 * redirect URIs, and every link inside an email. Getting it wrong doesn't fail
 * loudly — it produces a deployed app whose emails point at `localhost:3000`,
 * which only shows up once somebody clicks.
 *
 * Resolution order:
 *  1. `NEXT_PUBLIC_APP_URL` — always wins, and is required for a custom domain.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` — injected by Vercel, protocol-less. The
 *     *production* domain rather than `VERCEL_URL`, which is unique per
 *     deployment: a preview URL baked into an email would 404 the moment that
 *     deployment was superseded.
 *  3. localhost, for development.
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
