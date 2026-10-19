-- La foto delle persone dell'evento (organizzatore principale, moderatori,
-- relatori), caricata dallo staff e ricodificata dal server. Una riga puo'
-- servire piu' eventi: chi la usa la indica con una chiave che, se la foto
-- se ne va, torna vuota.

-- CreateTable
CREATE TABLE "event_person_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content_type" VARCHAR(32) NOT NULL,
    "bytes" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_person_photos_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "events" ADD COLUMN "moderator_photo_id" UUID;

-- AlterTable
ALTER TABLE "event_moderators" ADD COLUMN "photo_id" UUID;

-- CreateIndex
CREATE INDEX "events_moderator_photo_id_idx" ON "events"("moderator_photo_id");

-- CreateIndex
CREATE INDEX "event_moderators_photo_id_idx" ON "event_moderators"("photo_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_moderator_photo_id_fkey" FOREIGN KEY ("moderator_photo_id") REFERENCES "event_person_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_moderators" ADD CONSTRAINT "event_moderators_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "event_person_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
