import "server-only";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { USER_SELECT } from "@/lib/auth/select";
import type { SignInInput, SignUpInput } from "@/lib/api/contracts";
import { slugify } from "@/lib/utils";

/**
 * Account creation and credential checking, with no opinion about transport.
 *
 * The web form action and the API's `/auth/*` routes both land here, so there
 * is exactly one definition of what signing up does — one place that seeds a
 * schedule, one place that resists username collisions, one place that resists
 * timing attacks.
 */

const RESERVED_USERNAMES = new Set([
  "api",
  "app",
  "login",
  "signup",
  "logout",
  "dashboard",
  "settings",
  "admin",
  "book",
  "booking",
  "bookings",
  "event-types",
  "availability",
  "help",
  "support",
  "about",
  "pricing",
  "terms",
  "privacy",
  "_next",
  "static",
]);

/** Picks a free handle derived from the user's name, falling back to a suffix. */
async function allocateUsername(name: string, email: string) {
  const base = slugify(name) || slugify(email.split("@")[0] ?? "") || "member";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (RESERVED_USERNAMES.has(candidate)) continue;
    const taken = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export type CreateAccountResult =
  | { ok: true; user: Awaited<ReturnType<typeof createUser>> }
  | { ok: false; fieldErrors: Record<string, string> };

async function createUser(input: SignUpInput, username: string) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  // A new account is useless without availability, so seed a working schedule
  // and two starter event types in the same transaction.
  return db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        username,
        timeZone: input.timeZone,
      },
      select: USER_SELECT,
    });

    const schedule = await tx.schedule.create({
      data: {
        userId: created.id,
        name: "Working hours",
        timeZone: input.timeZone,
        isDefault: true,
        rules: {
          create: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startMinute: 9 * 60,
            endMinute: 17 * 60,
          })),
        },
      },
    });

    await tx.eventType.createMany({
      data: [
        {
          userId: created.id,
          scheduleId: schedule.id,
          slug: "intro-call",
          title: "Intro call",
          description: "A quick introduction to see if we should work together.",
          durationMinutes: 15,
          position: 0,
        },
        {
          userId: created.id,
          scheduleId: schedule.id,
          slug: "deep-dive",
          title: "Deep dive",
          description:
            "A working session. Recorded and transcribed so you get a recap afterwards.",
          durationMinutes: 45,
          bufferAfterMinutes: 10,
          recordingEnabled: true,
          transcriptionEnabled: true,
          sendRecapToAttendees: true,
          position: 1,
        },
      ],
    });

    return created;
  });
}

export async function createAccount(
  input: SignUpInput,
): Promise<CreateAccountResult> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: false,
      fieldErrors: { email: "That email is already registered" },
    };
  }

  const username = await allocateUsername(input.name, input.email);
  return { ok: true, user: await createUser(input, username) };
}

/** The user behind these credentials, or null. Constant-time on a miss. */
export async function authenticate(input: SignInInput) {
  const user = await db.user.findUnique({
    where: { email: input.email },
    select: { ...USER_SELECT, passwordHash: true },
  });

  // Compare against a dummy hash when the user is missing so the response time
  // doesn't leak which emails exist.
  const hash =
    user?.passwordHash ??
    "$2a$12$C6UzMDM.H6dfI/f/IKcEe.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const ok = await bcrypt.compare(input.password, hash);

  if (!user || !ok) return null;

  // Rebuilt field by field rather than spread-minus-hash: on a credential path,
  // what leaves this function should be a list you can read, not a subtraction.
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    timeZone: user.timeZone,
    brandColor: user.brandColor,
  };
}
