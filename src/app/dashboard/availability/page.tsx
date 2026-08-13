import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { ScheduleEditor } from "@/components/dashboard/schedule-editor";
import {
  addDateOverride,
  removeDateOverride,
} from "@/lib/availability/schedule-actions";
import { minutesToLabel } from "@/lib/utils";

export default async function AvailabilityPage() {
  const user = await requireUser();

  let schedule = await db.schedule.findFirst({
    where: { userId: user.id, isDefault: true },
    include: {
      rules: true,
      overrides: { orderBy: { date: "asc" } },
    },
  });

  // An account created before schedules existed — or one whose default was
  // deleted — still needs something to edit.
  if (!schedule) {
    schedule = await db.schedule.create({
      data: {
        userId: user.id,
        name: "Working hours",
        timeZone: user.timeZone,
        isDefault: true,
        rules: {
          create: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startMinute: 9 * 60,
            endMinute: 17 * 60,
          })),
        },
      },
      include: { rules: true, overrides: true },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = schedule.overrides.filter(
    (override) => override.date.toISOString().slice(0, 10) >= today,
  );

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight">Availability</h1>
        <p className="mt-1 text-sm text-text-muted">
          When people can book you. Meeting types can override this.
        </p>
      </header>

      <ScheduleEditor
        scheduleId={schedule.id}
        timeZone={schedule.timeZone}
        rules={schedule.rules.map((rule) => ({
          weekday: rule.weekday,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
        }))}
      />

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Date overrides</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            Block a day off, or set different hours for one date. Overrides
            replace the weekly hours entirely for that date.
          </p>
        </CardHeader>
        <CardBody className="space-y-5">
          {upcoming.length > 0 ? (
            <ul className="divide-y divide-border border-y border-border">
              {upcoming.map((override) => (
                <li
                  key={override.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div>
                    <p className="text-sm font-semibold">
                      {override.date.toISOString().slice(0, 10)}
                    </p>
                    <p className="text-xs text-text-muted">
                      {override.isBlocked
                        ? "Unavailable all day"
                        : `${minutesToLabel(override.startMinute ?? 0)} – ${minutesToLabel(
                            override.endMinute ?? 0,
                          )}`}
                    </p>
                  </div>
                  <form action={removeDateOverride}>
                    <input type="hidden" name="id" value={override.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Remove
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No overrides coming up.</p>
          )}

          <form action={addDateOverride} className="space-y-3">
            <input type="hidden" name="scheduleId" value={schedule.id} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date" htmlFor="override-date" required>
                <Input
                  id="override-date"
                  name="date"
                  type="date"
                  min={today}
                  required
                />
              </Field>
              <Field label="From" htmlFor="override-start">
                <Input id="override-start" name="start" type="time" />
              </Field>
              <Field label="To" htmlFor="override-end">
                <Input id="override-end" name="end" type="time" />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                name="blocked"
                className="size-4 accent-[var(--primary)]"
              />
              Unavailable all day (ignores the times above)
            </label>
            <Button type="submit" variant="secondary" size="sm">
              Add override
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
