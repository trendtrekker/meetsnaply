/*
  Warnings:

  - Added the required column `updatedAt` to the `CalendarConnection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "externalCalendarId" TEXT,
ADD COLUMN     "externalConnectionId" TEXT,
ADD COLUMN     "externalEventId" TEXT,
ADD COLUMN     "externalSyncError" TEXT;

-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN     "calendarId" TEXT NOT NULL DEFAULT 'primary',
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "providerAccountId" TEXT,
ADD COLUMN     "scope" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
