"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { minutesToLabel } from "@/lib/utils";
import { supportedTimeZones } from "@/lib/datetime";
import {
  saveSchedule,
  type ScheduleFormState,
} from "@/lib/availability/schedule-actions";

// Monday first, matching the calendar grid. The value is the JS weekday index.
const DAYS = [
  { index: 1, label: "Monday" },
  { index: 2, label: "Tuesday" },
  { index: 3, label: "Wednesday" },
  { index: 4, label: "Thursday" },
  { index: 5, label: "Friday" },
  { index: 6, label: "Saturday" },
  { index: 0, label: "Sunday" },
];

interface Range {
  start: string;
  end: string;
}

export function ScheduleEditor({
  scheduleId,
  timeZone,
  rules,
}: {
  scheduleId: string;
  timeZone: string;
  rules: { weekday: number; startMinute: number; endMinute: number }[];
}) {
  const [state, formAction, pending] = useActionState<
    ScheduleFormState,
    FormData
  >(saveSchedule, {});

  const [days, setDays] = useState<Record<number, Range[]>>(() => {
    const initial: Record<number, Range[]> = {};
    for (const day of DAYS) initial[day.index] = [];
    for (const rule of rules) {
      initial[rule.weekday] ??= [];
      initial[rule.weekday].push({
        start: minutesToLabel(rule.startMinute),
        end: minutesToLabel(rule.endMinute),
      });
    }
    for (const key of Object.keys(initial)) {
      initial[Number(key)].sort((a, b) => a.start.localeCompare(b.start));
    }
    return initial;
  });

  function update(weekday: number, next: Range[]) {
    setDays((prev) => ({ ...prev, [weekday]: next }));
  }

  const zones = supportedTimeZones();

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="scheduleId" value={scheduleId} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-field bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="rounded-field bg-success/10 px-3.5 py-2.5 text-sm font-medium text-success">
          Availability saved.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Weekly hours</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field
            label="Timezone"
            htmlFor="timeZone"
            hint="These hours are interpreted in this zone, including across DST."
          >
            <Select id="timeZone" name="timeZone" defaultValue={timeZone}>
              {zones.includes(timeZone) ? null : (
                <option value={timeZone}>{timeZone}</option>
              )}
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>

          <div className="divide-y divide-border border-t border-border">
            {DAYS.map((day) => {
              const ranges = days[day.index] ?? [];
              const enabled = ranges.length > 0;

              return (
                <div
                  key={day.index}
                  className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr] sm:items-start"
                >
                  <label className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      name={`day-${day.index}-enabled`}
                      checked={enabled}
                      onChange={(event) =>
                        update(
                          day.index,
                          event.target.checked
                            ? [{ start: "09:00", end: "17:00" }]
                            : [],
                        )
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="text-sm font-semibold">{day.label}</span>
                  </label>

                  <div className="space-y-2">
                    {!enabled ? (
                      <p className="text-sm text-text-muted">Unavailable</p>
                    ) : (
                      ranges.map((range, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            type="time"
                            name={`day-${day.index}-start`}
                            value={range.start}
                            onChange={(event) => {
                              const next = [...ranges];
                              next[index] = {
                                ...range,
                                start: event.target.value,
                              };
                              update(day.index, next);
                            }}
                            aria-label={`${day.label} start time`}
                            className="w-32"
                          />
                          <span className="text-text-muted">–</span>
                          <Input
                            type="time"
                            name={`day-${day.index}-end`}
                            value={range.end}
                            onChange={(event) => {
                              const next = [...ranges];
                              next[index] = {
                                ...range,
                                end: event.target.value,
                              };
                              update(day.index, next);
                            }}
                            aria-label={`${day.label} end time`}
                            className="w-32"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              update(
                                day.index,
                                ranges.filter((_, i) => i !== index),
                              )
                            }
                            aria-label={`Remove window from ${day.label}`}
                            className="grid size-9 shrink-0 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-danger"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      ))
                    )}

                    {enabled ? (
                      <button
                        type="button"
                        onClick={() =>
                          update(day.index, [
                            ...ranges,
                            { start: "18:00", end: "20:00" },
                          ])
                        }
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                      >
                        <Plus className="size-3.5" />
                        Add window
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </form>
  );
}
