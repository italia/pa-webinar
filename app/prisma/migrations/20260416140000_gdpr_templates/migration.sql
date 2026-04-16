-- GDPR Templates: reusable privacy notices shared across events.
--
-- Each template carries a multilingual body (JSONB with one key per
-- locale). Events reference a template via `gdpr_template_id`; when
-- the template is deleted the reference is cleared (ON DELETE SET NULL)
-- so we never lose the event, only the shared copy of the text.

CREATE TABLE "gdpr_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "description" TEXT,
  "body" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gdpr_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gdpr_templates_name_key" ON "gdpr_templates" ("name");

-- Only one template can be marked as default at any time. Using a
-- partial unique index lets us enforce this without a check constraint
-- and without blocking multiple non-default templates.
CREATE UNIQUE INDEX "gdpr_templates_only_one_default"
  ON "gdpr_templates" ((1))
  WHERE "is_default" = true;

ALTER TABLE "events"
  ADD COLUMN "gdpr_template_id" UUID,
  ADD CONSTRAINT "events_gdpr_template_id_fkey"
    FOREIGN KEY ("gdpr_template_id") REFERENCES "gdpr_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "events_gdpr_template_id_idx" ON "events" ("gdpr_template_id");
