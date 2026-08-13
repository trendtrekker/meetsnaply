import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { signIn } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Log in · meetsnaply" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Welcome back</h1>
      <p className="mt-1 mb-6 text-sm text-text-muted">
        Log in to see your generated meeting schedule.
      </p>
      <AuthForm mode="signin" action={signIn} />
    </>
  );
}
