"use server";

import { requireUser } from "@/lib/auth";
import {
  disconnectCalendarForUser,
  setConflictChecking,
  setDestinationCalendarForUser,
} from "./service";

/**
 * Form actions for the settings page. Each reads its `FormData` and hands off
 * to ./service, which the `/api/v1` routes call too.
 */

export async function disconnectCalendar(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await disconnectCalendarForUser(user.id, id);
}

export async function toggleConflictChecking(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await setConflictChecking(user.id, id, formData.get("enabled") === "true");
}

export async function setDestinationCalendar(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await setDestinationCalendarForUser(user.id, id);
}
