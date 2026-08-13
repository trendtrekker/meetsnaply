-- Booking.calendarUid identifies a meeting *as a calendar event*, which outlives
-- the booking row: a reschedule creates a new booking that inherits this value,
-- so the invitee's calendar sees one event that moved rather than a cancellation
-- followed by an unrelated new invitation.
--
-- Prisma generates the cuid default client-side, so the column can't be added as
-- NOT NULL to a table that already has rows. Added nullable, backfilled, then
-- tightened — the standard three-step for a required column on live data.

-- 1. Add nullable.
ALTER TABLE "Booking" ADD COLUMN "calendarUid" TEXT;

-- 2. Backfill. Existing bookings each become their own calendar event; a
--    reschedule chain among them is not reconstructed, since none of these were
--    ever issued an .ics under a shared identity.
UPDATE "Booking" SET "calendarUid" = gen_random_uuid()::text WHERE "calendarUid" IS NULL;

-- 3. Tighten.
ALTER TABLE "Booking" ALTER COLUMN "calendarUid" SET NOT NULL;

-- Not unique: a rescheduled booking shares its predecessor's value.
CREATE INDEX "Booking_calendarUid_idx" ON "Booking"("calendarUid");
