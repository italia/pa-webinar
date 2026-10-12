-- Trascrizione dell'evento dai sottotitoli live: chi e' in sala e le frasi salvate.
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "captions_transcript_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transcript_published" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "room_occupants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "endpoint_id" VARCHAR(64) NOT NULL,
    "seat_id" VARCHAR(80) NOT NULL,
    "meeting_id" VARCHAR(64),
    "joined_at" TIMESTAMP(3) NOT NULL,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "room_occupants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caption_segments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "message_id" VARCHAR(80) NOT NULL,
    "endpoint_id" VARCHAR(64) NOT NULL,
    "seat_id" VARCHAR(80),
    "speaker_name" TEXT,
    "text" TEXT,
    "language" VARCHAR(8),
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caption_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "room_occupants_event_id_seat_id_idx" ON "room_occupants"("event_id", "seat_id");

-- CreateIndex
CREATE INDEX "room_occupants_meeting_id_idx" ON "room_occupants"("meeting_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_occupants_event_id_endpoint_id_key" ON "room_occupants"("event_id", "endpoint_id");

-- CreateIndex
CREATE INDEX "caption_segments_event_id_started_at_idx" ON "caption_segments"("event_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "caption_segments_event_id_message_id_key" ON "caption_segments"("event_id", "message_id");

-- AddForeignKey
ALTER TABLE "room_occupants" ADD CONSTRAINT "room_occupants_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caption_segments" ADD CONSTRAINT "caption_segments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Il testo con cui e' stato dato il consenso alla trascrizione dei propri
-- interventi: i consensi gia' salvati sono del testo precedente, che parlava
-- solo della traccia audio.
ALTER TABLE "registrations" ADD COLUMN     "consent_multitrack_version" INTEGER;
ALTER TABLE "multitrack_consents" ADD COLUMN     "text_version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "multitrack_consents" ALTER COLUMN "text_version" SET DEFAULT 2;
