"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/utils";
import { isRecordable } from "@/lib/bookings/locations";

export interface EventTypeFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

const LOCATION_TYPES = [
  "MEETSNAPLY_VIDEO",
  "GOOGLE_MEET",
  "ZOOM",
  "MICROSOFT_TEAMS",
  "PHONE_HOST_CALLS",
  "PHONE_INVITEE_CALLS",
  "IN_PERSON",
  "CUSTOM",
] as const;

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.null(), z.undefined()])
  .transform((v) => v === "on" || v === "true");

const eventTypeSchema = z
  .object({
    title: z.string().trim().min(1, "Give it a name").max(120),
    slug: z.string().trim().max(60).optional(),
    description: z.string().trim().max(2000).optional(),
    durationMinutes: z.coerce.number().int().min(5).max(720),
    slotIntervalMinutes: z.coerce.number().int().min(5).max(120),
    bufferBeforeMinutes: z.coerce.number().int().min(0).max(240),
    bufferAfterMinutes: z.coerce.number().int().min(0).max(240),
    minimumNoticeMinutes: z.coerce.number().int().min(0).max(60 * 24 * 30),
    bookingHorizonDays: z.coerce.number().int().min(1).max(730),
    maxBookingsPerDay: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? Number(v) : null))
      .pipe(z.number().int().min(1).max(100).nullable()),
    /// Comma-separated minutes-before values, e.g. "1440, 60".
    reminderMinutes: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? "")
          .split(",")
          .map((part) => Number(part.trim()))
          .filter((minutes) => Number.isInteger(minutes) && minutes > 0)
          // Descending so the earliest reminder is listed first, and deduped so
          // a typo can't email everyone twice at the same moment.
          .filter((minutes, index, all) => all.indexOf(minutes) === index)
          .sort((a, b) => b - a)
          .slice(0, 5),
      ),
    locationType: z.enum(LOCATION_TYPES),
    locationValue: z.string().trim().max(500).optional(),
    scheduleId: z.string().optional(),
    isActive: checkbox,
    isPrivate: checkbox,
    requiresConfirmation: checkbox,
    recordingEnabled: checkbox,
    transcriptionEnabled: checkbox,
    sendRecapToAttendees: checkbox,
  })
  .refine((data) => data.locationType !== "IN_PERSON" || data.locationValue, {
    message: "Add the address",
    path: ["locationValue"],
  });

function readForm(formData: FormData) {
  return eventTypeSchema.safeParse({
    title: formData.get("title"),
    slug: formData.get("slug") ?? undefined,
    description: formData.get("description") ?? undefined,
    durationMinutes: formData.get("durationMinutes"),
    slotIntervalMinutes: formData.get("slotIntervalMinutes"),
    bufferBeforeMinutes: formData.get("bufferBeforeMinutes"),
    bufferAfterMinutes: formData.get("bufferAfterMinutes"),
    minimumNoticeMinutes: formData.get("minimumNoticeMinutes"),
    bookingHorizonDays: formData.get("bookingHorizonDays"),
    maxBookingsPerDay: formData.get("maxBookingsPerDay") ?? undefined,
    reminderMinutes: formData.get("reminderMinutes") ?? undefined,
    locationType: formData.get("locationType"),
    locationValue: formData.get("locationValue") ?? undefined,
    scheduleId: formData.get("scheduleId") ?? undefined,
    isActive: formData.get("isActive"),
    isPrivate: formData.get("isPrivate"),
    requiresConfirmation: formData.get("requiresConfirmation"),
    recordingEnabled: formData.get("recordingEnabled"),
    transcriptionEnabled: formData.get("transcriptionEnabled"),
    sendRecapToAttendees: formData.get("sendRecapToAttendees"),
  });
}

function collectErrors(error: z.ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return fieldErrors;
}

/** Ensures the slug is unique for this host, suffixing when it collides. */
async function uniqueSlug(userId: string, desired: string, excludeId?: string) {
  const base = slugify(desired) || "meeting";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const clash = await db.eventType.findFirst({
      where: {
        userId,
        slug: candidate,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Recording and transcription are only meaningful where we control the room,
 * and a recap cannot be sent without a transcript. Normalising here keeps the
 * database from holding combinations the pipeline can't honour.
 */
function normaliseRecording(data: z.infer<typeof eventTypeSchema>) {
  const canRecord = isRecordable(data.locationType);
  const recordingEnabled = canRecord && data.recordingEnabled;
  const transcriptionEnabled = recordingEnabled && data.transcriptionEnabled;
  return {
    recordingEnabled,
    transcriptionEnabled,
    sendRecapToAttendees: transcriptionEnabled && data.sendRecapToAttendees,
  };
}

export async function createEventType(
  _prev: EventTypeFormState,
  formData: FormData,
): Promise<EventTypeFormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return { fieldErrors: collectErrors(parsed.error) };

  const data = parsed.data;
  const slug = await uniqueSlug(user.id, data.slug || data.title);

  const created = await db.eventType.create({
    data: {
      userId: user.id,
      slug,
      title: data.title,
      description: data.description || null,
      durationMinutes: data.durationMinutes,
      slotIntervalMinutes: data.slotIntervalMinutes,
      bufferBeforeMinutes: data.bufferBeforeMinutes,
      bufferAfterMinutes: data.bufferAfterMinutes,
      minimumNoticeMinutes: data.minimumNoticeMinutes,
      bookingHorizonDays: data.bookingHorizonDays,
      maxBookingsPerDay: data.maxBookingsPerDay,
      reminderMinutes: data.reminderMinutes,
      locationType: data.locationType,
      locationValue: data.locationValue || null,
      scheduleId: data.scheduleId || null,
      isActive: data.isActive,
      isPrivate: data.isPrivate,
      requiresConfirmation: data.requiresConfirmation,
      ...normaliseRecording(data),
    },
    select: { id: true },
  });

  revalidatePath("/dashboard/event-types");
  redirect(`/dashboard/event-types/${created.id}`);
}

export async function updateEventType(
  _prev: EventTypeFormState,
  formData: FormData,
): Promise<EventTypeFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing event type" };

  const parsed = readForm(formData);
  if (!parsed.success) return { fieldErrors: collectErrors(parsed.error) };

  const owned = await db.eventType.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return { error: "Not found" };

  const data = parsed.data;
  const slug = await uniqueSlug(user.id, data.slug || data.title, id);

  await db.eventType.update({
    where: { id },
    data: {
      slug,
      title: data.title,
      description: data.description || null,
      durationMinutes: data.durationMinutes,
      slotIntervalMinutes: data.slotIntervalMinutes,
      bufferBeforeMinutes: data.bufferBeforeMinutes,
      bufferAfterMinutes: data.bufferAfterMinutes,
      minimumNoticeMinutes: data.minimumNoticeMinutes,
      bookingHorizonDays: data.bookingHorizonDays,
      maxBookingsPerDay: data.maxBookingsPerDay,
      reminderMinutes: data.reminderMinutes,
      locationType: data.locationType,
      locationValue: data.locationValue || null,
      scheduleId: data.scheduleId || null,
      isActive: data.isActive,
      isPrivate: data.isPrivate,
      requiresConfirmation: data.requiresConfirmation,
      ...normaliseRecording(data),
    },
  });

  revalidatePath("/dashboard/event-types");
  revalidatePath(`/dashboard/event-types/${id}`);
  return { ok: true };
}

export async function deleteEventType(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Bookings reference the event type with onDelete: Restrict, so archive
  // instead of deleting once anything has been booked against it.
  const bookingCount = await db.booking.count({ where: { eventTypeId: id } });

  if (bookingCount > 0) {
    await db.eventType.updateMany({
      where: { id, userId: user.id },
      data: { isActive: false, isPrivate: true },
    });
  } else {
    await db.eventType.deleteMany({ where: { id, userId: user.id } });
  }

  revalidatePath("/dashboard/event-types");
  redirect("/dashboard/event-types");
}
