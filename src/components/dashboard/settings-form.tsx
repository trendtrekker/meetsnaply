"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { supportedTimeZones } from "@/lib/datetime";
import {
  updateSettings,
  type SettingsFormState,
} from "@/lib/settings/actions";

export function SettingsForm({
  values,
  origin,
}: {
  values: {
    name: string;
    username: string;
    bio: string;
    timeZone: string;
  };
  origin: string;
}) {
  const [state, formAction, pending] = useActionState<
    SettingsFormState,
    FormData
  >(updateSettings, {});

  const zones = supportedTimeZones();

  return (
    <form action={formAction} className="space-y-5">
      {state.ok ? (
        <p className="rounded-field bg-success/10 px-3.5 py-2.5 text-sm font-medium text-success">
          Settings saved.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Account settings</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            View or edit your account information.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Name" htmlFor="name" required error={state.fieldErrors?.name}>
            <Input id="name" name="name" defaultValue={values.name} required />
          </Field>

          <Field
            label="Booking handle"
            htmlFor="username"
            required
            hint={`${origin.replace(/^https?:\/\//, "")}/${values.username}`}
            error={state.fieldErrors?.username}
          >
            <Input
              id="username"
              name="username"
              defaultValue={values.username}
              required
            />
          </Field>

          <Field label="Bio" htmlFor="bio" error={state.fieldErrors?.bio}>
            <Textarea
              id="bio"
              name="bio"
              defaultValue={values.bio}
              placeholder="Shown on your public booking page."
            />
          </Field>

          <Field
            label="Timezone"
            htmlFor="timeZone"
            hint="Used to display your dashboard and as the default for new schedules."
          >
            <Select
              id="timeZone"
              name="timeZone"
              defaultValue={values.timeZone}
            >
              {zones.includes(values.timeZone) ? null : (
                <option value={values.timeZone}>{values.timeZone}</option>
              )}
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
