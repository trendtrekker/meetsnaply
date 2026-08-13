import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { getCurrentUser } from "@/lib/auth";
import { consentUrl, isGoogleConfigured } from "@/lib/calendar/google";

function settingsUrl(error: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/dashboard/settings?calendar=${error}`;
}

/** Starts the Google Calendar consent flow for the signed-in host. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/login`,
    );
  }

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(settingsUrl("not-configured"));
  }

  // The state parameter is a short-lived signed token rather than a random
  // nonce in a cookie: it carries the user id, so the callback cannot be
  // replayed against a different account, and it expires on its own.
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
  const state = await new SignJWT({ userId: user.id, purpose: "google-calendar" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);

  return NextResponse.redirect(consentUrl(state));
}
