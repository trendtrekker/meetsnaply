import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { slugify } from "@/lib/utils";
import { isRecordable } from "@/lib/bookings/locations";
import type { EventTypeInputPayload } from "@/lib/api/contracts";

/**
 * Event-type writes, independent of transport.
 *
 * Two rules live here rather than in any form: slugs are made unique per host,
 * and the recording flags are normalised so the database never holds a
 * combination the pipeline can't honour.
 */

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
function normaliseRecording(data: EventTypeInputPayload) {
  const canRecord = isRecordable(data.locationType);
  const recordingEnabled = canRecord && data.recordingEnabled;
  const transcriptionEnabled = recordingEnabled && data.transcriptionEnabled;
  return {
    recordingEnabled,
    transcriptionEnabled,
    sendRecapToAttendees: transcriptionEnabled && data.sendRecapToAttendees,
  };
}

/** The columns shared by create and update. */
function columns(data: EventTypeInputPayload, slug: string) {
  return {
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
  };
}

export async function createEventTypeFor(
  userId: string,
  data: EventTypeInputPayload,
): Promise<{ id: string }> {
  const slug = await uniqueSlug(userId, data.slug || data.title);

  const created = await db.eventType.create({
    data: { userId, ...columns(data, slug) },
    select: { id: true },
  });

  revalidatePath("/dashboard/event-types");
  return created;
}

export async function updateEventTypeFor(
  userId: string,
  id: string,
  data: EventTypeInputPayload,
): Promise<{ ok: boolean }> {
  const owned = await db.eventType.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) return { ok: false };

  const slug = await uniqueSlug(userId, data.slug || data.title, id);
  await db.eventType.update({ where: { id }, data: columns(data, slug) });

  revalidatePath("/dashboard/event-types");
  revalidatePath(`/dashboard/event-types/${id}`);
  return { ok: true };
}

/**
 * Removes an event type, or retires it when it can't be removed.
 *
 * Bookings reference the event type with `onDelete: Restrict`, so anything ever
 * booked against it is archived — deactivated and hidden — rather than deleted.
 */
export async function removeEventType(
  userId: string,
  id: string,
): Promise<{ ok: boolean; archived: boolean }> {
  const bookingCount = await db.booking.count({ where: { eventTypeId: id } });

  const { count } =
    bookingCount > 0
      ? await db.eventType.updateMany({
          where: { id, userId },
          data: { isActive: false, isPrivate: true },
        })
      : await db.eventType.deleteMany({ where: { id, userId } });

  revalidatePath("/dashboard/event-types");
  return { ok: count > 0, archived: bookingCount > 0 };
}
