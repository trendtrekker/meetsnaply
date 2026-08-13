"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createSessionCookie } from "@/lib/auth/session";

export interface SettingsFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

const settingsSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "At least 3 characters")
    .max(40)
    .regex(
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
      "Letters, numbers and hyphens only",
    ),
  bio: z.string().trim().max(300).optional(),
  timeZone: z.string().trim().min(1),
});

export async function updateSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  const parsed = settingsSchema.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    bio: formData.get("bio") ?? undefined,
    timeZone: formData.get("timeZone"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  const { name, username, bio, timeZone } = parsed.data;

  if (username !== user.username) {
    const taken = await db.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (taken) {
      return { fieldErrors: { username: "That handle is taken" } };
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: { name, username, bio: bio || null, timeZone },
  });

  // The handle is baked into the session token, so reissue it.
  if (username !== user.username) {
    await createSessionCookie({ userId: user.id, email: user.email, username });
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
