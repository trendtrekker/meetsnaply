-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "calendarSequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "EventType" ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[];
