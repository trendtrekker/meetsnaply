"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { labelToMinutes } from "@/lib/utils";

export interface ScheduleFormState {
  error?: string;
  ok?: boolean;
}

/**
 * Replaces every weekly rule on a schedule in one transaction.
 *
 * The form posts `day-{weekday}-start[]` / `day-{weekday}-end[]` pairs plus a
 * `day-{weekday}-enabled` flag, which makes "clear all windows on Wednesday"
 * expressible — an empty array of ranges is a real state, not a missing field.
 */
export async function saveSchedule(
  _prev: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const user = await requireUser();
  const scheduleId = String(formData.get("scheduleId") ?? "");
  const timeZone = String(formData.get("timeZone") ?? "").trim();

  const schedule = await db.schedule.findFirst({
    where: { id: scheduleId, userId: user.id },
    select: { id: true },
  });
  if (!schedule) return { error: "Schedule not found" };

  const rules: { weekday: number; startMinute: number; endMinute: number }[] =
    [];

  for (let weekday = 0; weekday < 7; weekday++) {
    if (formData.get(`day-${weekday}-enabled`) !== "on") continue;

    const starts = formData.getAll(`day-${weekday}-start`).map(String);
    const ends = formData.getAll(`day-${weekday}-end`).map(String);

    for (let i = 0; i < starts.length; i++) {
      const startMinute = labelToMinutes(starts[i]);
      const endMinute = labelToMinutes(ends[i] ?? "");
      if (startMinute == null || endMinute == null) continue;
      if (endMinute <= startMinute) {
        return {
          error: `On ${DAY_NAMES[weekday]}, the end time must be after the start time.`,
        };
      }
      rules.push({ weekday, startMinute, endMinute });
    }
  }

  // Overlapping windows on the same day would produce duplicate slots.
  for (let weekday = 0; weekday < 7; weekday++) {
    const dayRules = rules
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < dayRules.length; i++) {
      if (dayRules[i].startMinute < dayRules[i - 1].endMinute) {
        return { error: `${DAY_NAMES[weekday]} has overlapping windows.` };
      }
    }
  }

  await db.$transaction([
    db.availabilityRule.deleteMany({ where: { scheduleId } }),
    db.availabilityRule.createMany({
      data: rules.map((rule) => ({ ...rule, scheduleId })),
    }),
    db.schedule.update({
      where: { id: scheduleId },
      data: timeZone ? { timeZone } : {},
    }),
  ]);

  revalidatePath("/dashboard/availability");
  return { ok: true };
}

export async function addDateOverride(formData: FormData) {
  const user = await requireUser();
  const scheduleId = String(formData.get("scheduleId") ?? "");
  const date = String(formData.get("date") ?? "");
  const blocked = formData.get("blocked") === "on";
  const start = labelToMinutes(String(formData.get("start") ?? ""));
  const end = labelToMinutes(String(formData.get("end") ?? ""));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const schedule = await db.schedule.findFirst({
    where: { id: scheduleId, userId: user.id },
    select: { id: true },
  });
  if (!schedule) return;

  const isBlocked = blocked || start == null || end == null || end <= start;

  await db.dateOverride.upsert({
    where: { scheduleId_date: { scheduleId, date: new Date(`${date}T00:00:00Z`) } },
    create: {
      scheduleId,
      date: new Date(`${date}T00:00:00Z`),
      isBlocked,
      startMinute: isBlocked ? null : start,
      endMinute: isBlocked ? null : end,
    },
    update: {
      isBlocked,
      startMinute: isBlocked ? null : start,
      endMinute: isBlocked ? null : end,
    },
  });

  revalidatePath("/dashboard/availability");
}

export async function removeDateOverride(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await db.dateOverride.deleteMany({
    where: { id, schedule: { userId: user.id } },
  });

  revalidatePath("/dashboard/availability");
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
