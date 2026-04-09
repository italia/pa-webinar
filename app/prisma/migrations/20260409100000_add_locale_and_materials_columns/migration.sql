-- AlterTable: site_settings — i18n / locale management columns
ALTER TABLE "site_settings"
  ADD COLUMN IF NOT EXISTS "available_locales" JSONB NOT NULL DEFAULT '["it","en"]',
  ADD COLUMN IF NOT EXISTS "locale_names" JSONB NOT NULL DEFAULT '{"it":"Italiano","en":"English"}',
  ADD COLUMN IF NOT EXISTS "translation_overrides" JSONB NOT NULL DEFAULT '{}';

-- AlterTable: event_materials — file upload / Azure Blob columns
ALTER TABLE "event_materials"
  ADD COLUMN IF NOT EXISTS "file_name" TEXT,
  ADD COLUMN IF NOT EXISTS "file_size" BIGINT,
  ADD COLUMN IF NOT EXISTS "mime_type" TEXT,
  ADD COLUMN IF NOT EXISTS "blob_path" TEXT,
  ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'ALWAYS';
