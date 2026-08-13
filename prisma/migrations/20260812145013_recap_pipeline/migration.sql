-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "MeetingRecap" ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "openQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "outputTokens" INTEGER;

-- AlterTable
ALTER TABLE "MeetingRecording" ADD COLUMN     "purgedAt" TIMESTAMP(3),
ADD COLUMN     "roomName" TEXT;

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecapDelivery" (
    "id" TEXT NOT NULL,
    "recapId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "attendeeId" TEXT,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "error" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecapDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_idx" ON "Job"("status", "runAfter");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "RecapDelivery_recapId_idx" ON "RecapDelivery"("recapId");

-- CreateIndex
CREATE UNIQUE INDEX "RecapDelivery_recapId_email_key" ON "RecapDelivery"("recapId", "email");

-- CreateIndex
CREATE INDEX "MeetingRecording_roomName_idx" ON "MeetingRecording"("roomName");

-- AddForeignKey
ALTER TABLE "RecapDelivery" ADD CONSTRAINT "RecapDelivery_recapId_fkey" FOREIGN KEY ("recapId") REFERENCES "MeetingRecap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecapDelivery" ADD CONSTRAINT "RecapDelivery_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
