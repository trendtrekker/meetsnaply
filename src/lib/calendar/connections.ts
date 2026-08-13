import "server-only";
import { db } from "@/lib/db";
import { encrypt, tryDecrypt } from "@/lib/crypto";
import {
  GoogleAuthError,
  refreshAccessToken,
  type GoogleTokens,
} from "./google";

/** A connection with a usable, non-expired access token. */
export interface LiveConnection {
  id: string;
  userId: string;
  accountEmail: string;
  calendarId: string;
  accessToken: string;
  checkConflicts: boolean;
  isDestination: boolean;
}

// Refresh a little early so a token can't expire mid-request.
const EXPIRY_SKEW_MS = 60_000;

export async function persistTokens(options: {
  userId: string;
  accountEmail: string;
  providerAccountId: string | null;
  tokens: GoogleTokens;
  calendarId?: string;
}) {
  const { userId, accountEmail, providerAccountId, tokens } = options;

  // The first calendar a user connects becomes the write target.
  const existingDestination = await db.calendarConnection.findFirst({
    where: { userId, isDestination: true },
    select: { id: true },
  });

  const shared = {
    providerAccountId,
    accessToken: encrypt(tokens.accessToken),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    lastError: null,
    lastErrorAt: null,
    lastSyncedAt: new Date(),
    ...(tokens.refreshToken
      ? { refreshToken: encrypt(tokens.refreshToken) }
      : {}),
    ...(options.calendarId ? { calendarId: options.calendarId } : {}),
  };

  return db.calendarConnection.upsert({
    where: {
      userId_provider_accountEmail: {
        userId,
        provider: "GOOGLE",
        accountEmail,
      },
    },
    create: {
      userId,
      provider: "GOOGLE",
      accountEmail,
      checkConflicts: true,
      isDestination: !existingDestination,
      ...shared,
    },
    update: shared,
  });
}

/** Records that a connection is broken so settings can prompt a reconnect. */
export async function markConnectionBroken(id: string, message: string) {
  await db.calendarConnection.update({
    where: { id },
    data: {
      lastError: message.slice(0, 500),
      lastErrorAt: new Date(),
      // Stop it silently blocking every slot on the booking page.
      checkConflicts: false,
    },
  });
}

/**
 * Returns a connection with a fresh access token, refreshing and re-persisting
 * when the stored one is close to expiry.
 *
 * Returns null — rather than throwing — when the connection is unusable, so
 * callers can decide whether a missing calendar is fatal.
 */
async function activate(connection: {
  id: string;
  userId: string;
  accountEmail: string;
  calendarId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  checkConflicts: boolean;
  isDestination: boolean;
}): Promise<LiveConnection | null> {
  const stillValid =
    connection.expiresAt &&
    connection.expiresAt.getTime() - EXPIRY_SKEW_MS > Date.now();

  if (stillValid) {
    const accessToken = tryDecrypt(connection.accessToken);
    if (accessToken) {
      return { ...connection, accessToken };
    }
    // Ciphertext we can't open (rotated key) — fall through to a refresh.
  }

  const refreshToken = tryDecrypt(connection.refreshToken);
  if (!refreshToken) {
    await markConnectionBroken(
      connection.id,
      "No usable refresh token. Reconnect this calendar.",
    );
    return null;
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    await db.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: encrypt(tokens.accessToken),
        expiresAt: tokens.expiresAt,
        ...(tokens.refreshToken
          ? { refreshToken: encrypt(tokens.refreshToken) }
          : {}),
        lastError: null,
        lastErrorAt: null,
      },
    });
    return { ...connection, accessToken: tokens.accessToken };
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      await markConnectionBroken(connection.id, error.message);
      return null;
    }
    // Transient: leave the connection alone so it recovers on its own.
    throw error;
  }
}

const SELECT = {
  id: true,
  userId: true,
  accountEmail: true,
  calendarId: true,
  accessToken: true,
  refreshToken: true,
  expiresAt: true,
  checkConflicts: true,
  isDestination: true,
} as const;

/** Live connections to consult for conflicts. */
export async function conflictConnections(
  userId: string,
): Promise<LiveConnection[]> {
  const rows = await db.calendarConnection.findMany({
    where: { userId, provider: "GOOGLE", checkConflicts: true },
    select: SELECT,
  });

  const live = await Promise.all(rows.map(activate));
  return live.filter((connection): connection is LiveConnection =>
    Boolean(connection),
  );
}

/** The single calendar bookings are mirrored into, if any. */
export async function destinationConnection(
  userId: string,
): Promise<LiveConnection | null> {
  const row = await db.calendarConnection.findFirst({
    where: { userId, provider: "GOOGLE", isDestination: true },
    select: SELECT,
  });
  if (!row) return null;
  return activate(row);
}
