"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  bookSlotInput,
  cancelBookingInput,
  setBookingStatusInput,
} from "@/lib/api/contracts";
import {
  bookSlot,
  cancelBookingByUid,
  setBookingStatusForHost,
} from "./service";

/**
 * Form actions for the public booking page and the host dashboard.
 *
 * These read `FormData`, shape it into the input the service expects, and turn
 * the result into a redirect or a form state. The booking itself lives in
 * ./service, which the `/api/v1` routes call too.
 */

export interface BookingFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/** The form sends guests as one free-text field; the service wants addresses. */
function splitGuests(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[,\s;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Question answers arrive as repeated `q_<identifier>` fields. Re-key them by
 * identifier so the service never has to know about the form's naming.
 */
function collectAnswers(formData: FormData): Record<string, string[]> {
  const answers: Record<string, string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("q_")) continue;
    const identifier = key.slice(2);
    (answers[identifier] ??= []).push(String(value));
  }
  return answers;
}

function flatten(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function createBooking(
  _prev: BookingFormState,
  formData: FormData,
): Promise<BookingFormState> {
  const parsed = bookSlotInput.safeParse({
    username: formData.get("username"),
    slug: formData.get("slug"),
    start: formData.get("start"),
    timeZone: formData.get("timeZone"),
    name: formData.get("name"),
    email: formData.get("email"),
    guests: splitGuests(formData.get("guests")),
    consentRecording: formData.get("consentRecording") === "on",
    rescheduleOf: formData.get("rescheduleOf") || undefined,
    answers: collectAnswers(formData),
  });

  if (!parsed.success) {
    return { fieldErrors: flatten(parsed.error) };
  }

  const result = await bookSlot(parsed.data);
  if (!result.ok) {
    return { error: result.error, fieldErrors: result.fieldErrors };
  }

  redirect(`/booking/${result.uid}`);
}

export async function cancelBooking(formData: FormData) {
  const parsed = cancelBookingInput.safeParse({
    uid: formData.get("uid"),
    reason: String(formData.get("reason") ?? "").trim() || undefined,
  });
  if (!parsed.success) return;

  // Only redirect when something was actually cancelled. An unknown or
  // already-cancelled uid falls through to a re-render of the page the form
  // lives on, which is what it did before this moved into the service.
  const result = await cancelBookingByUid(parsed.data);
  if (!result.ok) return;

  redirect(`/booking/${parsed.data.uid}`);
}

/** Host-side confirmation for event types that require approval. */
export async function setBookingStatus(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = setBookingStatusInput.safeParse({
    uid: formData.get("uid"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;

  await setBookingStatusForHost(user.id, parsed.data);
}
