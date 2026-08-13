import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { db } from "@/lib/db";
import { persistTokens } from "@/lib/calendar/connections";
import {
  GOOGLE_SCOPES,
  exchangeCode,
  fetchAccountEmail,
  isGoogleConfigured,
} from "@/lib/calendar/google";

function back(status: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return NextResponse.redirect(`${base}/dashboard/settings?calendar=${status}`);
}

async function userIdFromState(state: string | null): Promise<string | null> {
  if (!state || !process.env.AUTH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(
      state,
      new TextEncoder().encode(process.env.AUTH_SECRET),
      { algorithms: ["HS256"] },
    );
    if (payload.purpose !== "google-calendar") return null;
    return typeof payload.userId === "string" ? payload.userId : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) return back("not-configured");

  const params = request.nextUrl.searchParams;

  // The user can decline on the consent screen; that is not an error.
  const denied = params.get("error");
  if (denied) {
    return back(denied === "access_denied" ? "cancelled" : "failed");
  }

  const userId = await userIdFromState(params.get("state"));
  const code = params.get("code");
  if (!userId || !code) return back("failed");

  // The state token proves intent, but the account could have been deleted
  // between starting the flow and returning from it.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user) return back("failed");

  try {
    const tokens = await exchangeCode(code);

    // Google honours per-scope opt-outs on the consent screen. Without the
    // events scope we could read availability but never write a booking, so
    // refuse rather than store a half-working connection.
    const granted = new Set((tokens.scope ?? "").split(" "));
    const missing = GOOGLE_SCOPES.filter(
      (scope) => !scope.includes("userinfo") && !granted.has(scope),
    );
    if (missing.length > 0) {
      return back("insufficient-scope");
    }

    const account = await fetchAccountEmail(tokens.accessToken);

    if (!tokens.refreshToken) {
      // Without one we cannot keep the connection alive past an hour.
      return back("no-refresh-token");
    }

    await persistTokens({
      userId,
      accountEmail: account.email,
      providerAccountId: account.id,
      tokens,
    });

    return back("connected");
  } catch {
    return back("failed");
  }
}
