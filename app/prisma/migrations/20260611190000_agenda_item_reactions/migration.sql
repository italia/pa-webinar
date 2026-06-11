-- Audience pulse: assenso/dissenso dei partecipanti su un singolo punto
-- d'agenda. Vedi AgendaItemReaction + EventAgendaItem.reactions.
-- Dedup per identità (registrationId | guestId), allineato a poll_votes.

-- CreateEnum
CREATE TYPE "AgendaReactionValue" AS ENUM ('AGREE', 'DISAGREE');

-- CreateTable
CREATE TABLE "agenda_item_reactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agenda_item_id" UUID NOT NULL,
    "registration_id" UUID,
    "guest_id" TEXT,
    "value" "AgendaReactionValue" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agenda_item_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agenda_item_reactions_agenda_item_id_idx" ON "agenda_item_reactions"("agenda_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_item_reactions_agenda_item_id_registration_id_key" ON "agenda_item_reactions"("agenda_item_id", "registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_item_reactions_agenda_item_id_guest_id_key" ON "agenda_item_reactions"("agenda_item_id", "guest_id");

-- AddForeignKey
ALTER TABLE "agenda_item_reactions" ADD CONSTRAINT "agenda_item_reactions_agenda_item_id_fkey" FOREIGN KEY ("agenda_item_id") REFERENCES "event_agenda_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_item_reactions" ADD CONSTRAINT "agenda_item_reactions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
