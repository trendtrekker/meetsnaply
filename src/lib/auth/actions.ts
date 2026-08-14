"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { signInInput, signUpInput } from "@/lib/api/contracts";
import { authenticate, createAccount } from "./accounts";
import { createSessionCookie, destroySessionCookie } from "./session";

/**
 * Form actions for the web app.
 *
 * These own three things and nothing else: reading `FormData`, turning a
 * failure into something the form can render, and setting the session cookie
 * before redirecting. The work itself lives in ./accounts, which the API routes
 * call too.
 */

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpInput.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    timeZone: formData.get("timeZone") || "UTC",
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const result = await createAccount(parsed.data);
  if (!result.ok) {
    return { fieldErrors: result.fieldErrors };
  }

  await createSessionCookie({
    userId: result.user.id,
    email: result.user.email,
    username: result.user.username,
  });
  redirect("/dashboard");
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInInput.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const user = await authenticate(parsed.data);
  if (!user) {
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
