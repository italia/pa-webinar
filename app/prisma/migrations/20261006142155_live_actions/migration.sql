-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "media_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "live_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(64) NOT NULL,
    "actor" VARCHAR(16),
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "live_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_actions_event_id_at_idx" ON "live_actions"("event_id", "at");

-- AddForeignKey
ALTER TABLE "live_actions" ADD CONSTRAINT "live_actions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
