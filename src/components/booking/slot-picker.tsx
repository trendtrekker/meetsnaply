"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WEEKDAY_LABELS,
  dayKey,
  formatDate,
  formatTime,
  monthGrid,
  monthLabel,
  shiftMonthKey,
  supportedTimeZones,
  zoneAbbreviation,
} from "@/lib/datetime";

export interface SlotPickerProps {
  /** ISO instants, ascending. Generated on the server for the visible month. */
  slots: string[];
  month: string;
  /**
   * Controlled by the parent. The booking summary and the hidden form field
   * read the same value, so a slot can never be labelled in one zone and
   * submitted in another.
   */
  timeZone: string;
  onTimeZoneChange: (timeZone: string) => void;
  durationMinutes: number;
  onPicked?: (iso: string) => void;
  selected?: string | null;
}

export function SlotPicker({
  slots,
  month,
  timeZone,
  onTimeZoneChange,
  durationMinutes,
  onPicked,
  selected,
}: SlotPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [hour12, setHour12] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const parsed = useMemo(() => slots.map((iso) => new Date(iso)), [slots]);

  // Grouping happens in the invitee's zone, so the same UTC instant can land on
  // a different calendar day than the host sees. That is correct and intended.
  const byDay = useMemo(() => {
    const map = new Map<string, Date[]>();
    for (const slot of parsed) {
      const key = dayKey(slot, timeZone);
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    }
    return map;
  }, [parsed, timeZone]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const todayKey = dayKey(new Date(), timeZone);

  const day = activeDay ?? firstDayWithSlots(cells, byDay);
  const daySlots = day ? (byDay.get(day) ?? []) : [];

  function goToMonth(delta: number) {
    const next = shiftMonthKey(month, delta);
    const params = new URLSearchParams(searchParams);
    params.set("month", next);
    setActiveDay(null);
    startTransition(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  const zones = useMemo(() => supportedTimeZones(), []);

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_15rem] md:gap-8">
      {/* ---------------- calendar ---------------- */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{monthLabel(month)}</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToMonth(-1)}
              disabled={pending}
              aria-label="Previous month"
              className="grid size-9 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => goToMonth(1)}
              disabled={pending}
              aria-label="Next month"
              className="grid size-9 place-items-center rounded-full text-text-muted transition-colors hover:bg-surface-muted hover:text-text disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div
          className="grid grid-cols-7 gap-1 text-center"
          role="grid"
          aria-label="Choose a date"
        >
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="pb-2 text-[0.6875rem] font-bold tracking-wider text-text-muted"
            >
              {label}
            </div>
          ))}

          {cells.map((cell) => {
            const count = byDay.get(cell.key)?.length ?? 0;
            const available = count > 0;
            const isSelected = day === cell.key;
            const isToday = cell.key === todayKey;

            return (
              <button
                key={cell.key}
                type="button"
                role="gridcell"
                disabled={!available}
                aria-selected={isSelected}
                aria-label={
                  available
                    ? `${cell.key}, ${count} slots available`
                    : `${cell.key}, no availability`
                }
                onClick={() => setActiveDay(cell.key)}
                className={cn(
                  "relative aspect-square rounded-xl text-sm font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  !cell.inMonth && "opacity-35",
                  available
                    ? "bg-primary-soft text-primary hover:bg-brand-200 dark:hover:bg-brand-900"
                    : "text-text-muted/60",
                  isSelected && "bg-primary text-primary-fg hover:bg-primary",
                  isToday && !isSelected && "ring-1 ring-border-strong",
                )}
              >
                {cell.day}
              </button>
            );
          })}
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-text-muted">
          <span className="size-2.5 rounded-full bg-primary-soft" />
          Available
        </p>
      </div>

      {/* ---------------- slots ---------------- */}
      <div className="flex min-w-0 flex-col">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-bold">
            {day ? formatDate(new Date(`${day}T12:00:00Z`), "UTC") : "Pick a date"}
          </h3>
          <button
            type="button"
            onClick={() => setHour12((v) => !v)}
            className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-[0.6875rem] font-bold text-text-muted transition-colors hover:text-text"
          >
            {hour12 ? "12h" : "24h"}
          </button>
        </div>

        <div className="scrollbar-thin -mr-1 max-h-[22rem] space-y-2 overflow-y-auto pr-1">
          {daySlots.length === 0 ? (
            <p className="rounded-panel border border-dashed border-border-strong px-4 py-6 text-center text-sm text-text-muted">
              {byDay.size === 0
                ? "Nothing free this month. Try the next one."
                : "No times left on this day."}
            </p>
          ) : (
            daySlots.map((slot) => {
              const iso = slot.toISOString();
              const isSelected = selected === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => onPicked?.(iso)}
                  aria-pressed={isSelected}
                  className={cn(
                    "w-full rounded-field border px-4 py-3 text-sm font-bold transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                    isSelected
                      ? "border-primary bg-primary text-primary-fg"
                      : "border-border-strong bg-surface hover:border-primary hover:text-primary",
                  )}
                >
                  {formatTime(slot, timeZone, hour12)}
                </button>
              );
            })
          )}
        </div>

        {/* Timezone must be visible and changeable right here — not in a modal. */}
        <label className="mt-4 block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <Globe className="size-3.5" />
            Times shown in {zoneAbbreviation(new Date(), timeZone)}
          </span>
          <select
            value={timeZone}
            onChange={(event) => {
              onTimeZoneChange(event.target.value);
              setActiveDay(null);
            }}
            aria-label="Timezone"
            className="w-full rounded-field border border-border-strong bg-surface px-3 py-2 text-sm"
          >
            {zones.includes(timeZone) ? null : (
              <option value={timeZone}>{timeZone}</option>
            )}
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <p className="mt-3 text-xs text-text-muted">
          {durationMinutes} minute meeting
        </p>
      </div>
    </div>
  );
}

function firstDayWithSlots(
  cells: { key: string; inMonth: boolean }[],
  byDay: Map<string, Date[]>,
) {
  for (const cell of cells) {
    if (cell.inMonth && (byDay.get(cell.key)?.length ?? 0) > 0) return cell.key;
  }
  return null;
}
