-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrganizationType" AS ENUM ('MINISTRY', 'AGENCY', 'REGION', 'PROVINCE', 'MUNICIPALITY', 'ASL', 'UNIVERSITY', 'PUBLIC_ENTITY', 'IN_HOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('PENDING', 'HIGHLIGHTED', 'ANSWERED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED', 'PUBLISHED');

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title_it" TEXT NOT NULL,
    "title_en" TEXT,
    "description_it" TEXT NOT NULL,
    "description_en" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Rome',
    "max_participants" INTEGER NOT NULL DEFAULT 300,
    "jitsi_room_name" TEXT NOT NULL,
    "qa_enabled" BOOLEAN NOT NULL DEFAULT true,
    "chat_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recording_enabled" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_unmute" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_start_video" BOOLEAN NOT NULL DEFAULT false,
    "participants_can_share_screen" BOOLEAN NOT NULL DEFAULT false,
    "require_organization" BOOLEAN NOT NULL DEFAULT false,
    "require_organization_role" BOOLEAN NOT NULL DEFAULT false,
    "require_organization_type" BOOLEAN NOT NULL DEFAULT false,
    "moderator_token" TEXT NOT NULL,
    "moderator_name" TEXT,
    "moderator_email" TEXT,
    "data_retention_days" INTEGER NOT NULL DEFAULT 30,
    "privacy_policy_url" TEXT,
    "privacy_policy_text" TEXT,
    "speakers_it" TEXT,
    "speakers_en" TEXT,
    "organizer_name" TEXT,
    "image_url" TEXT,
    "waiting_room_audio_url" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "recording_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_hash" TEXT NOT NULL,
    "organization" TEXT,
    "organization_role" TEXT,
    "organization_type" "OrganizationType",
    "consent_given" BOOLEAN NOT NULL,
    "consent_timestamp" TIMESTAMP(3) NOT NULL,
    "consent_recording" BOOLEAN,
    "consent_future_communications" BOOLEAN NOT NULL DEFAULT false,
    "access_token" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3),
    "left_at" TIMESTAMP(3),
    "confirmation_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "author_name" TEXT NOT NULL,
    "text" VARCHAR(500) NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'PENDING',
    "upvote_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "highlighted_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_upvotes" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_upvotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "polls" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "question" VARCHAR(300) NOT NULL,
    "options" JSONB NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "polls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_votes" (
    "id" UUID NOT NULL,
    "poll_id" UUID NOT NULL,
    "registration_id" UUID,
    "guest_id" TEXT,
    "option_index" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_materials" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LINK',
    "title" VARCHAR(300) NOT NULL,
    "url" TEXT NOT NULL,
    "description" VARCHAR(500),
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_reminders" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_sent" (
    "id" UUID NOT NULL,
    "reminder_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_sent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gdpr_audit_logs" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "record_count" INTEGER NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gdpr_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "events_jitsi_room_name_key" ON "events"("jitsi_room_name");

-- CreateIndex
CREATE UNIQUE INDEX "events_moderator_token_key" ON "events"("moderator_token");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_access_token_key" ON "registrations"("access_token");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_event_id_email_hash_key" ON "registrations"("event_id", "email_hash");

-- CreateIndex
CREATE INDEX "questions_event_id_status_upvote_count_idx" ON "questions"("event_id", "status", "upvote_count" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "question_upvotes_question_id_registration_id_key" ON "question_upvotes"("question_id", "registration_id");

-- CreateIndex
CREATE INDEX "polls_event_id_status_idx" ON "polls"("event_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_poll_id_registration_id_key" ON "poll_votes"("poll_id", "registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "poll_votes_poll_id_guest_id_key" ON "poll_votes"("poll_id", "guest_id");

-- CreateIndex
CREATE INDEX "event_materials_event_id_idx" ON "event_materials"("event_id");

-- CreateIndex
CREATE INDEX "event_reminders_event_id_idx" ON "event_reminders"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_sent_reminder_id_registration_id_key" ON "reminder_sent"("reminder_id", "registration_id");

-- CreateIndex
CREATE INDEX "gdpr_audit_logs_event_id_idx" ON "gdpr_audit_logs"("event_id");

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_upvotes" ADD CONSTRAINT "question_upvotes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_upvotes" ADD CONSTRAINT "question_upvotes_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "polls" ADD CONSTRAINT "polls_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "polls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_materials" ADD CONSTRAINT "event_materials_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_reminders" ADD CONSTRAINT "event_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "event_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gdpr_audit_logs" ADD CONSTRAINT "gdpr_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

