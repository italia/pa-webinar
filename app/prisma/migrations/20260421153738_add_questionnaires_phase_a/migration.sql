-- Questionnaires, phase A (per-event only — no cross-event Person yet).
-- See docs/adr/011-person-rubrica.md for the planned phase B.
--
-- Adds five tables:
--   question_templates          — reusable question groups (library)
--   question_items              — questions; polymorphic owner
--                                 (template_id XOR questionnaire_id set)
--   event_questionnaires        — per-event instance (pre/post placement)
--   questionnaire_template_links — M2M: which templates each questionnaire uses
--   questionnaire_responses     — one per (questionnaire, registration|guest)
--   questionnaire_answers       — one per (response, item)
--
-- Plus two enums: QuestionItemType, QuestionnairePlacement.

-- CreateEnum
CREATE TYPE "QuestionItemType" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'YES_NO', 'LIKERT', 'OPEN_TEXT');

-- CreateEnum
CREATE TYPE "QuestionnairePlacement" AS ENUM ('PRE_REGISTRATION', 'POST_EVENT');

-- CreateTable
CREATE TABLE "question_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_items" (
    "id" UUID NOT NULL,
    "template_id" UUID,
    "questionnaire_id" UUID,
    "prompt" JSONB NOT NULL,
    "type" "QuestionItemType" NOT NULL,
    "options" JSONB,
    "scale_min" INTEGER,
    "scale_max" INTEGER,
    "scale_min_label" JSONB,
    "scale_max_label" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_items_pkey" PRIMARY KEY ("id")
);

-- Enforce the polymorphic owner contract: exactly one of template_id
-- or questionnaire_id must be set. Prevents orphans and double-owners.
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_owner_chk"
  CHECK ((template_id IS NOT NULL)::int + (questionnaire_id IS NOT NULL)::int = 1);

-- CreateTable
CREATE TABLE "event_questionnaires" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "placement" "QuestionnairePlacement" NOT NULL,
    "title" JSONB NOT NULL DEFAULT '{}',
    "description" JSONB NOT NULL DEFAULT '{}',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "allow_edit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_questionnaires_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_template_links" (
    "questionnaire_id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "questionnaire_template_links_pkey" PRIMARY KEY ("questionnaire_id","template_id")
);

-- CreateTable
CREATE TABLE "questionnaire_responses" (
    "id" UUID NOT NULL,
    "questionnaire_id" UUID NOT NULL,
    "registration_id" UUID,
    "guest_id" TEXT,
    "respondent_name" TEXT,
    "respondent_email_hash" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "questionnaire_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questionnaire_answers" (
    "id" UUID NOT NULL,
    "response_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "value_text" TEXT,
    "value_choices" JSONB,
    "value_scale" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questionnaire_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_templates_name_key" ON "question_templates"("name");

-- CreateIndex
CREATE INDEX "question_items_template_id_sort_order_idx" ON "question_items"("template_id", "sort_order");

-- CreateIndex
CREATE INDEX "question_items_questionnaire_id_sort_order_idx" ON "question_items"("questionnaire_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "event_questionnaires_event_id_placement_key" ON "event_questionnaires"("event_id", "placement");

-- CreateIndex
CREATE INDEX "questionnaire_template_links_template_id_idx" ON "questionnaire_template_links"("template_id");

-- CreateIndex
CREATE INDEX "questionnaire_responses_questionnaire_id_idx" ON "questionnaire_responses"("questionnaire_id");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_questionnaire_id_registration_id_key" ON "questionnaire_responses"("questionnaire_id", "registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_responses_questionnaire_id_guest_id_key" ON "questionnaire_responses"("questionnaire_id", "guest_id");

-- CreateIndex
CREATE INDEX "questionnaire_answers_item_id_idx" ON "questionnaire_answers"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "questionnaire_answers_response_id_item_id_key" ON "questionnaire_answers"("response_id", "item_id");

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "question_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_items" ADD CONSTRAINT "question_items_questionnaire_id_fkey" FOREIGN KEY ("questionnaire_id") REFERENCES "event_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_questionnaires" ADD CONSTRAINT "event_questionnaires_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_template_links" ADD CONSTRAINT "questionnaire_template_links_questionnaire_id_fkey" FOREIGN KEY ("questionnaire_id") REFERENCES "event_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_template_links" ADD CONSTRAINT "questionnaire_template_links_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "question_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_questionnaire_id_fkey" FOREIGN KEY ("questionnaire_id") REFERENCES "event_questionnaires"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_responses" ADD CONSTRAINT "questionnaire_responses_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_answers" ADD CONSTRAINT "questionnaire_answers_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "questionnaire_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questionnaire_answers" ADD CONSTRAINT "questionnaire_answers_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "question_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
