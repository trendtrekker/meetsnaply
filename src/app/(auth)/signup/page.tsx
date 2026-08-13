import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { signUp } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Get started · meetsnaply" };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <>
      <h1 className="text-2xl font-extrabold tracking-tight">Get started</h1>
      <p className="mt-1 mb-6 text-sm text-text-muted">
        Your booking link and a working-hours schedule are created for you.
      </p>
      <AuthForm mode="signup" action={signUp} />
    </>
  );
}
