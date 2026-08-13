"use client";

import { useActionState, useEffect, useState } from "react";
import { ArrowLeft, Clock, Mic, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SlotPicker } from "./slot-picker";
import { createBooking, type BookingFormState } from "@/lib/bookings/actions";
import { formatDateTime, zoneAbbreviation } from "@/lib/datetime";
import { formatDuration } from "@/lib/utils";

interface Question {
  id: string;
  identifier: string;
  label: string;
  helpText: string | null;
  type: string;
  required: boolean;
  options: string[];
}

export interface BookingFlowProps {
  username: string;
  slug: string;
  title: string;
  durationMinutes: number;
  locationLabel: string;
  month: string;
  slots: string[];
  initialTimeZone: string;
  questions: Question[];
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  sendRecapToAttendees: boolean;
  rescheduleOf?: string;
}

export function BookingFlow(props: BookingFlowProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(props.initialTimeZone);
  const [state, formAction, pending] = useActionState<
    BookingFormState,
    FormData
  >(createBooking, {});

  // The server has no way to know the invitee's zone, so it renders labels in
  // the host's and the client corrects them once. This has to happen after
  // mount: reading Intl during render would make the first client render
  // disagree with the server HTML.
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a client-only value on mount
    if (detected) setTimeZone(detected);
  }, []);

  const recorded = props.recordingEnabled || props.transcriptionEnabled;

  if (!selected) {
    return (
      <SlotPicker
        slots={props.slots}
        month={props.month}
        timeZone={timeZone}
        onTimeZoneChange={setTimeZone}
        durationMinutes={props.durationMinutes}
        selected={selected}
        onPicked={setSelected}
      />
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="username" value={props.username} />
      <input type="hidden" name="slug" value={props.slug} />
      <input type="hidden" name="start" value={selected} />
      <input type="hidden" name="timeZone" value={timeZone} />
      {props.rescheduleOf ? (
        <input type="hidden" name="rescheduleOf" value={props.rescheduleOf} />
      ) : null}

      <button
        type="button"
        onClick={() => setSelected(null)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
      >
        <ArrowLeft className="size-4" />
        Change time
      </button>

      <div className="rounded-panel bg-surface-muted px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Clock className="size-4 shrink-0 text-primary" />
          {formatDateTime(new Date(selected), timeZone)}
        </p>
        <p className="mt-1 pl-6 text-xs text-text-muted">
          {formatDuration(props.durationMinutes)} · {props.locationLabel} ·{" "}
          {zoneAbbreviation(new Date(selected), timeZone)}
        </p>
      </div>

      {state.error ? (
        <p
          role="alert"
          className="rounded-field bg-danger/10 px-3.5 py-2.5 text-sm font-medium text-danger"
        >
          {state.error}
        </p>
      ) : null}

      <Field label="Your name" htmlFor="name" required error={state.fieldErrors?.name}>
        <Input id="name" name="name" autoComplete="name" required />
      </Field>

      <Field label="Email" htmlFor="email" required error={state.fieldErrors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>

      <Field
        label="Add guests"
        htmlFor="guests"
        hint="Comma-separated email addresses."
        error={state.fieldErrors?.guests}
      >
        <Input id="guests" name="guests" placeholder="sam@company.com, alex@company.com" />
      </Field>

      {props.questions.map((question) => (
        <QuestionField
          key={question.id}
          question={question}
          error={state.fieldErrors?.[`q_${question.identifier}`]}
        />
      ))}

      {recorded ? (
        <div className="rounded-panel border border-border bg-surface-muted p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            {props.transcriptionEnabled ? (
              <Mic className="size-4 shrink-0 text-primary" />
            ) : (
              <Video className="size-4 shrink-0 text-primary" />
            )}
            This meeting is recorded
            {props.transcriptionEnabled ? " and transcribed" : ""}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
            {props.sendRecapToAttendees
              ? "Everyone on the call gets the summary, action items, and full transcript by email afterwards."
              : "The recording is available to the host after the call."}{" "}
            You can ask for it to be deleted at any time.
          </p>
          <label className="mt-3 flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="consentRecording"
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              required
            />
            <span>I agree to being recorded on this call.</span>
          </label>
          {state.fieldErrors?.consentRecording ? (
            <p role="alert" className="mt-2 text-xs font-medium text-danger">
              {state.fieldErrors.consentRecording}
            </p>
          ) : null}
        </div>
      ) : null}

      <Button type="submit" size="lg" fullWidth disabled={pending}>
        {pending ? "Booking…" : "Confirm booking"}
      </Button>
    </form>
  );
}

function QuestionField({
  question,
  error,
}: {
  question: Question;
  error?: string;
}) {
  const name = `q_${question.identifier}`;
  const id = `field-${question.identifier}`;

  return (
    <Field
      label={question.label}
      htmlFor={id}
      required={question.required}
      hint={question.helpText ?? undefined}
      error={error}
    >
      {question.type === "TEXTAREA" ? (
        <Textarea id={id} name={name} required={question.required} />
      ) : question.type === "SELECT" ? (
        <Select id={id} name={name} required={question.required} defaultValue="">
          <option value="" disabled>
            Choose one
          </option>
          {question.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      ) : question.type === "RADIO" ? (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{question.label}</legend>
          {question.options.map((option) => (
            <label key={option} className="flex items-center gap-2.5 text-sm">
              <input
                type="radio"
                name={name}
                value={option}
                required={question.required}
                className="size-4 accent-[var(--primary)]"
              />
              {option}
            </label>
          ))}
        </fieldset>
      ) : question.type === "MULTISELECT" || question.type === "CHECKBOX" ? (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">{question.label}</legend>
          {(question.options.length ? question.options : ["Yes"]).map(
            (option) => (
              <label key={option} className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  value={option}
                  className="size-4 accent-[var(--primary)]"
                />
                {option}
              </label>
            ),
          )}
        </fieldset>
      ) : (
        <Input
          id={id}
          name={name}
          type={
            question.type === "PHONE"
              ? "tel"
              : question.type === "NUMBER"
                ? "number"
                : question.type === "URL"
                  ? "url"
                  : "text"
          }
          required={question.required}
        />
      )}
    </Field>
  );
}
