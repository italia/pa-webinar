-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "jitsi_room_name" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration" INTEGER,
    "peak_participants" INTEGER NOT NULL DEFAULT 0,
    "participants" JSONB NOT NULL DEFAULT '[]',
    "recording_url" TEXT,
    "recording_file_size" BIGINT,
    "recording_duration" INTEGER,
    "recording_filename" TEXT,
    "telemetry" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "call_sessions_event_id_idx" ON "call_sessions"("event_id");

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
