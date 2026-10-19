-- Il programma preparato prima dell'evento: per ogni argomento dell'agenda
-- chi interviene, una persona dell'evento o l'organizzatore principale. Se
-- la persona se ne va (pulizia, cancellazione dei dati), l'argomento resta
-- senza nome.

-- AlterTable
ALTER TABLE "event_agenda_items" ADD COLUMN "speaker_grant_id" UUID,
ADD COLUMN "speaker_primary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "event_agenda_items_speaker_grant_id_idx" ON "event_agenda_items"("speaker_grant_id");

-- AddForeignKey
ALTER TABLE "event_agenda_items" ADD CONSTRAINT "event_agenda_items_speaker_grant_id_fkey" FOREIGN KEY ("speaker_grant_id") REFERENCES "event_moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
