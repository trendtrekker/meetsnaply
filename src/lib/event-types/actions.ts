"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { eventTypeInput } from "@/lib/api/contracts";
import {
  createEventTypeFor,
  removeEventType,
  updateEventTypeFor,
} from "./service";

export interface EventTypeFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

/** An HTML checkbox is present-and-"on" or absent entirely. */
function checked(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true";
}

/** "1440, 60" → [1440, 60]. Non-numeric parts are dropped, not rejected. */
function readReminders(value: FormDataEntryValue | null): number[] {
  return String(value ?? "")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((minutes) => Number.isInteger(minutes) && minutes > 0);
}

/**
 * Turns the form's strings into the shape the contract describes. Ordering,
 * deduplication, and the recording rules are applied downstream, so this only
 * has to get the types right.
 */
function readForm(formData: FormData) {
  const maxPerDay = String(formData.get("maxBookingsPerDay") ?? "").trim();

  return eventTypeInput.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug") ?? undefined,
    description: formData.get("description") ?? undefined,
    durationMinutes: formData.get("durationMinutes"),
    slotIntervalMinutes: formData.get("slotIntervalMinutes"),
    bufferBeforeMinutes: formData.get("bufferBeforeMinutes"),
    bufferAfterMinutes: formData.get("bufferAfterMinutes"),
    minimumNoticeMinutes: formData.get("minimumNoticeMinutes"),
    bookingHorizonDays: formData.get("bookingHorizonDays"),
    maxBookingsPerDay: maxPerDay ? maxPerDay : null,
    reminderMinutes: readReminders(formData.get("reminderMinutes")),
    locationType: formData.get("locationType"),
    locationValue: formData.get("locationValue") ?? undefined,
    scheduleId: formData.get("scheduleId") ?? undefined,
    isActive: checked(formData.get("isActive")),
    isPrivate: checked(formData.get("isPrivate")),
    requiresConfirmation: checked(formData.get("requiresConfirmation")),
    recordingEnabled: checked(formData.get("recordingEnabled")),
    transcriptionEnabled: checked(formData.get("transcriptionEnabled")),
    sendRecapToAttendees: checked(formData.get("sendRecapToAttendees")),
  });
}

function collectErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

export async function createEventType(
  _prev: EventTypeFormState,
  formData: FormData,
): Promise<EventTypeFormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return { fieldErrors: collectErrors(parsed.error) };

  const created = await createEventTypeFor(user.id, parsed.data);
  redirect(`/dashboard/event-types/${created.id}`);
}

export async function updateEventType(
  _prev: EventTypeFormState,
  formData: FormData,
): Promise<EventTypeFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing event type" };

  const parsed = readForm(formData);
  if (!parsed.success) return { fieldErrors: collectErrors(parsed.error) };

  const result = await updateEventTypeFor(user.id, id, parsed.data);
  return result.ok ? { ok: true } : { error: "Not found" };
}

export async function deleteEventType(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await removeEventType(user.id, id);
  redirect("/dashboard/event-types");
}
