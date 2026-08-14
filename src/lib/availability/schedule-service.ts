import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type {
  DateOverrideInput,
  SaveScheduleInput,
} from "@/lib/api/contracts";

/**
 * Weekly rules and date overrides, independent of transport.
 *
 * The web form speaks in "HH:MM" labels and per-day enabled checkboxes; this
 * speaks in minutes from midnight and a flat list of windows. Converting one to
 * the other is the caller's job — see the wrapper in ./schedule-actions.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type ScheduleResult = { ok: true } | { ok: false; error: string };

/** Rejects inverted and overlapping windows, which would produce duplicate slots. */
function validateRules(rules: SaveScheduleInput["rules"]): string | null {
  for (const rule of rules) {
    if (rule.endMinute <= rule.startMinute) {
      return `On ${DAY_NAMES[rule.weekday]}, the end time must be after the start time.`;
    }
  }

  for (let weekday = 0; weekday < 7; weekday++) {
    const dayRules = rules
      .filter((r) => r.weekday === weekday)
      .sort((a, b) => a.startMinute - b.startMinute);
    for (let i = 1; i < dayRules.length; i++) {
      if (dayRules[i].startMinute < dayRules[i - 1].endMinute) {
        return `${DAY_NAMES[weekday]} has overlapping windows.`;
      }
    }
  }

  return null;
}

/** Replaces every weekly rule on a schedule in one transaction. */
export async function saveWeeklyRules(
  userId: string,
  input: SaveScheduleInput,
): Promise<ScheduleResult> {
  const schedule = await db.schedule.findFirst({
    where: { id: input.scheduleId, userId },
    select: { id: true },
  });
  if (!schedule) return { ok: false, error: "Schedule not found" };

  const invalid = validateRules(input.rules);
  if (invalid) return { ok: false, error: invalid };

  await db.$transaction([
    db.availabilityRule.deleteMany({ where: { scheduleId: input.scheduleId } }),
    db.availabilityRule.createMany({
      data: input.rules.map((rule) => ({
        ...rule,
        scheduleId: input.scheduleId,
      })),
    }),
    db.schedule.update({
      where: { id: input.scheduleId },
      data: input.timeZone ? { timeZone: input.timeZone } : {},
    }),
  ]);

  revalidatePath("/dashboard/availability");
  return { ok: true };
}

export async function upsertDateOverride(
  userId: string,
  input: DateOverrideInput,
): Promise<{ ok: boolean }> {
  const schedule = await db.schedule.findFirst({
    where: { id: input.scheduleId, userId },
    select: { id: true },
  });
  if (!schedule) return { ok: false };

  // An override with no usable window *is* a block: there is no third state,
  // and a half-filled range would silently open the whole day.
  const { startMinute: start, endMinute: end } = input;
  const isBlocked =
    input.blocked || start == null || end == null || end <= start;

  const date = new Date(`${input.date}T00:00:00Z`);
  const fields = {
    isBlocked,
    startMinute: isBlocked ? null : start,
    endMinute: isBlocked ? null : end,
  };

  await db.dateOverride.upsert({
    where: { scheduleId_date: { scheduleId: input.scheduleId, date } },
    create: { scheduleId: input.scheduleId, date, ...fields },
    update: fields,
  });

  revalidatePath("/dashboard/availability");
  return { ok: true };
}

export async function deleteDateOverride(
  userId: string,
  id: string,
): Promise<{ ok: boolean }> {
  const { count } = await db.dateOverride.deleteMany({
    where: { id, schedule: { userId } },
  });

  revalidatePath("/dashboard/availability");
  return { ok: count > 0 };
}
