"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createSessionCookie } from "@/lib/auth/session";
import { updateSettingsInput } from "@/lib/api/contracts";
import { updateProfile } from "./service";

export interface SettingsFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function updateSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const user = await requireUser();

  const parsed = updateSettingsInput.safeParse({
    name: formData.get("name"),
    username: formData.get("username"),
    bio: formData.get("bio") ?? undefined,
    timeZone: formData.get("timeZone"),
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const result = await updateProfile(user, parsed.data);
  if (!result.ok) {
    return { fieldErrors: result.fieldErrors };
  }

  // The handle is baked into the session token, so reissue it.
  if (result.usernameChanged) {
    await createSessionCookie({
      userId: user.id,
      email: user.email,
      username: result.user.username,
    });
  }

  return { ok: true };
}
