"use client";

import { useActionState, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { LOCATION_LABELS, RECORDABLE_LOCATIONS } from "@/lib/bookings/locations";
import type { EventTypeFormState } from "@/lib/event-types/actions";
import type { LocationType } from "@/generated/prisma/enums";

export interface EventTypeValues {
  id?: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  slotIntervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  bookingHorizonDays: number;
  maxBookingsPerDay: number | null;
  reminderMinutes: number[];
  locationType: LocationType;
  locationValue: string;
  scheduleId: string | null;
  isActive: boolean;
  isPrivate: boolean;
  requiresConfirmation: boolean;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  sendRecapToAttendees: boolean;
}

type Action = (
  state: EventTypeFormState,
  formData: FormData,
) => Promise<EventTypeFormState>;

export function EventTypeForm({
  values,
  action,
  schedules,
  bookingBaseUrl,
  submitLabel,
}: {
  values: EventTypeValues;
  action: Action;
  schedules: { id: string; name: string; timeZone: string }[];
  bookingBaseUrl: string;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<
    EventTypeFormState,
    FormData
  >(action, {});

  const [locationType, setLocationType] = useState<LocationType>(
    values.locationType,
  );
  const [recording, setRecording] = useState(values.recordingEnabled);
  const [transcription, setTranscription] = useState(
    values.transcriptionEnabled,
  );
  const [recap, setRecap] = useState(values.sendRecapToAttendees);

  const canRecord = RECORDABLE_LOCATIONS.includes(locationType);

  return (
    <form action={formAction} className="space-y-5">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}

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
          Saved.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Name" htmlFor="title" required error={state.fieldErrors?.title}>
            <Input
              id="title"
              name="title"
              defaultValue={values.title}
              placeholder="Intro call"
              required
            />
          </Field>

          <Field
            label="Link"
            htmlFor="slug"
            hint={`${bookingBaseUrl}/…`}
            error={state.fieldErrors?.slug}
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={values.slug}
              placeholder="intro-call"
            />
          </Field>

          <Field label="Description" htmlFor="description">
            <Textarea
              id="description"
              name="description"
              defaultValue={values.description}
              placeholder="What should the invitee expect?"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Duration (minutes)" htmlFor="durationMinutes" required>
              <Input
                id="durationMinutes"
                name="durationMinutes"
                type="number"
                min={5}
                max={720}
                defaultValue={values.durationMinutes}
                required
              />
            </Field>
            <Field
              label="Slot interval (minutes)"
              htmlFor="slotIntervalMinutes"
              hint="How far apart the offered start times are."
            >
              <Input
                id="slotIntervalMinutes"
                name="slotIntervalMinutes"
                type="number"
                min={5}
                max={120}
                defaultValue={values.slotIntervalMinutes}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Location</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Where" htmlFor="locationType">
            <Select
              id="locationType"
              name="locationType"
              value={locationType}
              onChange={(event) =>
                setLocationType(event.target.value as LocationType)
              }
            >
              {(Object.keys(LOCATION_LABELS) as LocationType[]).map((key) => (
                <option key={key} value={key}>
                  {LOCATION_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>

          {locationType === "IN_PERSON" ||
          locationType === "CUSTOM" ||
          locationType === "PHONE_INVITEE_CALLS" ? (
            <Field
              label={
                locationType === "IN_PERSON"
                  ? "Address"
                  : locationType === "PHONE_INVITEE_CALLS"
                    ? "Phone number"
                    : "Instructions"
              }
              htmlFor="locationValue"
              required={locationType === "IN_PERSON"}
              error={state.fieldErrors?.locationValue}
            >
              <Input
                id="locationValue"
                name="locationValue"
                defaultValue={values.locationValue}
              />
            </Field>
          ) : (
            <input
              type="hidden"
              name="locationValue"
              value={values.locationValue}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduling rules</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <Field label="Availability schedule" htmlFor="scheduleId">
            <Select
              id="scheduleId"
              name="scheduleId"
              defaultValue={values.scheduleId ?? ""}
            >
              <option value="">Default schedule</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.name} ({schedule.timeZone})
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Buffer before (minutes)" htmlFor="bufferBeforeMinutes">
              <Input
                id="bufferBeforeMinutes"
                name="bufferBeforeMinutes"
                type="number"
                min={0}
                max={240}
                defaultValue={values.bufferBeforeMinutes}
              />
            </Field>
            <Field label="Buffer after (minutes)" htmlFor="bufferAfterMinutes">
              <Input
                id="bufferAfterMinutes"
                name="bufferAfterMinutes"
                type="number"
                min={0}
                max={240}
                defaultValue={values.bufferAfterMinutes}
              />
            </Field>
            <Field
              label="Minimum notice (minutes)"
              htmlFor="minimumNoticeMinutes"
              hint="Nothing can be booked sooner than this."
            >
              <Input
                id="minimumNoticeMinutes"
                name="minimumNoticeMinutes"
                type="number"
                min={0}
                defaultValue={values.minimumNoticeMinutes}
              />
            </Field>
            <Field
              label="Bookable window (days)"
              htmlFor="bookingHorizonDays"
              hint="How far ahead the calendar is open."
            >
              <Input
                id="bookingHorizonDays"
                name="bookingHorizonDays"
                type="number"
                min={1}
                max={730}
                defaultValue={values.bookingHorizonDays}
              />
            </Field>
          </div>

          <Field
            label="Maximum bookings per day"
            htmlFor="maxBookingsPerDay"
            hint="Leave empty for no cap."
          >
            <Input
              id="maxBookingsPerDay"
              name="maxBookingsPerDay"
              type="number"
              min={1}
              max={100}
              defaultValue={values.maxBookingsPerDay ?? ""}
            />
          </Field>

          <Field
            label="Reminder emails"
            htmlFor="reminderMinutes"
            hint="Minutes before the start, comma-separated. 1440 is a day. Leave empty to send none."
            error={state.fieldErrors?.reminderMinutes}
          >
            <Input
              id="reminderMinutes"
              name="reminderMinutes"
              defaultValue={values.reminderMinutes.join(", ")}
              placeholder="1440, 60"
            />
          </Field>

          <div className="space-y-2.5 border-t border-border pt-4">
            <Toggle
              name="isActive"
              label="Active"
              hint="Inactive types can't be booked at all."
              defaultChecked={values.isActive}
            />
            <Toggle
              name="isPrivate"
              label="Hidden from my public page"
              hint="Still bookable by direct link."
              defaultChecked={values.isPrivate}
            />
            <Toggle
              name="requiresConfirmation"
              label="Require my approval"
              hint="Bookings arrive as requests you confirm or decline."
              defaultChecked={values.requiresConfirmation}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recording &amp; transcription</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          {!canRecord ? (
            <p className="rounded-panel bg-surface-muted px-3.5 py-2.5 text-sm text-text-muted">
              Recording is only available on meetsnaply video calls, where we
              control the room. Switch the location to enable it.
            </p>
          ) : null}

          <Toggle
            name="recordingEnabled"
            label="Record the call"
            hint="Every attendee must accept before the meeting can be booked."
            disabled={!canRecord}
            checked={canRecord && recording}
            onChange={(next) => {
              setRecording(next);
              if (!next) {
                setTranscription(false);
                setRecap(false);
              }
            }}
          />
          <Toggle
            name="transcriptionEnabled"
            label="Transcribe the recording"
            hint="Speaker-labelled transcript, searchable afterwards."
            disabled={!canRecord || !recording}
            checked={canRecord && recording && transcription}
            onChange={(next) => {
              setTranscription(next);
              if (!next) setRecap(false);
            }}
          />
          <Toggle
            name="sendRecapToAttendees"
            label="Email the recap to attendees"
            hint="Summary, decisions, and action items sent to everyone once the call ends."
            disabled={!canRecord || !recording || !transcription}
            checked={canRecord && recording && transcription && recap}
            onChange={setRecap}
          />
        </CardBody>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
}) {
  const controlled = checked !== undefined;

  return (
    <label
      className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <input
        type="checkbox"
        name={name}
        disabled={disabled}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        {...(controlled
          ? {
              checked,
              onChange: (event) => onChange?.(event.target.checked),
            }
          : { defaultChecked })}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {hint ? (
          <span className="block text-xs text-text-muted">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}
