-- Presentazione di un PDF nella sala (lib/presentation/state.ts): una riga per
-- evento con il materiale presentato e la pagina corrente. Solo aggiunte.

-- CreateTable
CREATE TABLE "event_presentations" (
    "event_id" UUID NOT NULL,
    "material_id" UUID,
    "page" INTEGER NOT NULL DEFAULT 1,
    "page_count" INTEGER,
    "presenter_role" VARCHAR(16),
    "presenter_grant_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_presentations_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "event_presentations_material_id_idx" ON "event_presentations"("material_id");

-- CreateIndex
CREATE INDEX "event_presentations_presenter_grant_id_idx" ON "event_presentations"("presenter_grant_id");

-- AddForeignKey
ALTER TABLE "event_presentations" ADD CONSTRAINT "event_presentations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_presentations" ADD CONSTRAINT "event_presentations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "event_materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_presentations" ADD CONSTRAINT "event_presentations_presenter_grant_id_fkey" FOREIGN KEY ("presenter_grant_id") REFERENCES "event_moderators"("id") ON DELETE SET NULL ON UPDATE CASCADE;
