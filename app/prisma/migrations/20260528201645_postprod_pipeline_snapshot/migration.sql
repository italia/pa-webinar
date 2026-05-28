-- Snapshot della pipeline AI per la singola registrazione (motori,
-- modelli, voci, lingue, data run). JSONB free-form, default {}.
ALTER TABLE "recordings"
ADD COLUMN "pipeline_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb;
