"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AuthFormState } from "@/lib/auth/actions";

type Action = (
  state: AuthFormState,
  formData: FormData,
) => Promise<AuthFormState>;

export function AuthForm({
  mode,
  action,
}: {
  mode: "signin" | "signup";
  action: Action;
}) {
  const isSignUp = mode === "signup";

  // Runs on the client, so this is where the visitor's zone is known. Reading
  // it at submit time avoids both an effect and a hydration mismatch.
  const withTimeZone = async (state: AuthFormState, formData: FormData) => {
    if (isSignUp) {
      formData.set(
        "timeZone",
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      );
    }
    return action(state, formData);
  };

  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    withTimeZone,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">

      {state.error ? (
        <p
          role="alert"
          className="rounded-field bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}

      {isSignUp ? (
        <Field
          label="Your name"
          htmlFor="name"
          required
          error={state.fieldErrors?.name}
        >
          <Input
            id="name"
            name="name"
            autoComplete="name"
            placeholder="Damir Ciao"
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </Field>
      ) : null}

      <Field label="Email" htmlFor="email" required error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          aria-invalid={Boolean(state.fieldErrors?.email)}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        hint={isSignUp ? "At least 8 characters." : undefined}
        error={state.fieldErrors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          aria-invalid={Boolean(state.fieldErrors?.password)}
          required
        />
      </Field>

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending
          ? "One moment…"
          : isSignUp
            ? "Create account"
            : "Log in"}
      </Button>

      <p className="text-center text-sm text-text-muted">
        {isSignUp ? "Have an account? " : "New here? "}
        <Link
          href={isSignUp ? "/login" : "/signup"}
          className="font-semibold text-primary hover:underline"
        >
          {isSignUp ? "Login" : "Get started"}
        </Link>
      </p>
    </form>
  );
}
