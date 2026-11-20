-- Le richieste di una persona di non comparire in una registrazione, con il
-- loro stato. Solo aggiunte: la release precedente non legge questa tabella.

-- CreateEnum
CREATE TYPE "RecordingRedactionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PROCESSING', 'CLOSED', 'REJECTED');

-- CreateTable
CREATE TABLE "recording_redaction_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "recording_id" UUID,
    "source" VARCHAR(16) NOT NULL,
    "status" "RecordingRedactionStatus" NOT NULL DEFAULT 'OPEN',
    "display_name" TEXT NOT NULL,
    "email_hash" VARCHAR(64),
    "registration_id" UUID,
    "seat_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "endpoint_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposed_intervals" JSONB NOT NULL DEFAULT '[]',
    "intervals" JSONB,
    "job_id" UUID,
    "note" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "recording_redaction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recording_redaction_requests_event_id_idx" ON "recording_redaction_requests"("event_id");

-- CreateIndex
CREATE INDEX "recording_redaction_requests_recording_id_idx" ON "recording_redaction_requests"("recording_id");

-- CreateIndex
CREATE INDEX "recording_redaction_requests_status_idx" ON "recording_redaction_requests"("status");

-- CreateIndex
CREATE INDEX "recording_redaction_requests_email_hash_idx" ON "recording_redaction_requests"("email_hash");

-- CreateIndex
CREATE INDEX "recording_redaction_requests_job_id_idx" ON "recording_redaction_requests"("job_id");

-- AddForeignKey
ALTER TABLE "recording_redaction_requests" ADD CONSTRAINT "recording_redaction_requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_redaction_requests" ADD CONSTRAINT "recording_redaction_requests_recording_id_fkey" FOREIGN KEY ("recording_id") REFERENCES "recordings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_redaction_requests" ADD CONSTRAINT "recording_redaction_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "postprod_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
