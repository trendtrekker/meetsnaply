"use server";

import { requireUser } from "@/lib/auth";
import { labelToMinutes } from "@/lib/utils";
import type { WeeklyRuleInput } from "@/lib/api/contracts";
import {
  deleteDateOverride,
  saveWeeklyRules,
  upsertDateOverride,
} from "./schedule-service";

export interface ScheduleFormState {
  error?: string;
  ok?: boolean;
}

/**
 * Form actions for the availability page.
 *
 * The form posts `day-{weekday}-start[]` / `day-{weekday}-end[]` pairs plus a
 * `day-{weekday}-enabled` flag, which makes "clear all windows on Wednesday"
 * expressible — an empty array of ranges is a real state, not a missing field.
 * Turning that into a flat list of windows is this file's whole job; the rules
 * about what a valid week looks like live in ./schedule-service.
 */
function readRules(formData: FormData): WeeklyRuleInput[] {
  const rules: WeeklyRuleInput[] = [];

  for (let weekday = 0; weekday < 7; weekday++) {
    if (formData.get(`day-${weekday}-enabled`) !== "on") continue;

    const starts = formData.getAll(`day-${weekday}-start`).map(String);
    const ends = formData.getAll(`day-${weekday}-end`).map(String);

    for (let i = 0; i < starts.length; i++) {
      const startMinute = labelToMinutes(starts[i]);
      const endMinute = labelToMinutes(ends[i] ?? "");
      // An unparseable pair is a row the user left blank, not an error.
      if (startMinute == null || endMinute == null) continue;
      rules.push({ weekday, startMinute, endMinute });
    }
  }

  return rules;
}

export async function saveSchedule(
  _prev: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const user = await requireUser();

  const result = await saveWeeklyRules(user.id, {
    scheduleId: String(formData.get("scheduleId") ?? ""),
    timeZone: String(formData.get("timeZone") ?? "").trim(),
    rules: readRules(formData),
  });

  return result.ok ? { ok: true } : { error: result.error };
}

export async function addDateOverride(formData: FormData) {
  const user = await requireUser();

  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  await upsertDateOverride(user.id, {
    scheduleId: String(formData.get("scheduleId") ?? ""),
    date,
    blocked: formData.get("blocked") === "on",
    startMinute: labelToMinutes(String(formData.get("start") ?? "")),
    endMinute: labelToMinutes(String(formData.get("end") ?? "")),
  });
}

export async function removeDateOverride(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await deleteDateOverride(user.id, id);
}
