"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { createSessionCookie, destroySessionCookie } from "./session";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

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

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  timeZone: z.string().trim().min(1).default("UTC"),
});

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

/** Picks a free handle derived from the user's name, falling back to a suffix. */
async function allocateUsername(name: string, email: string) {
  const base =
    slugify(name) || slugify(email.split("@")[0] ?? "") || "member";

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

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    timeZone: formData.get("timeZone") || "UTC",
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }
  const { name, email, password, timeZone } = parsed.data;

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    return { fieldErrors: { email: "That email is already registered" } };
  }

  const username = await allocateUsername(name, email);
  const passwordHash = await bcrypt.hash(password, 12);

  // A new account is useless without availability, so seed a working schedule
  // and two starter event types in the same transaction.
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name, email, passwordHash, username, timeZone },
    });

    const schedule = await tx.schedule.create({
      data: {
        userId: created.id,
        name: "Working hours",
        timeZone,
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

  await createSessionCookie({
    userId: user.id,
    email: user.email,
    username: user.username,
  });
  redirect("/dashboard");
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
  });

  // Compare against a dummy hash when the user is missing so the response time
  // doesn't leak which emails exist.
  const hash =
    user?.passwordHash ??
    "$2a$12$C6UzMDM.H6dfI/f/IKcEe.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const ok = await bcrypt.compare(parsed.data.password, hash);

  if (!user || !ok) {
    return { error: "Those credentials don't match an account." };
  }

  await createSessionCookie({
    userId: user.id,
    email: user.email,
    username: user.username,
  });
  redirect("/dashboard");
}

export async function signOut() {
  await destroySessionCookie();
  redirect("/login");
}
