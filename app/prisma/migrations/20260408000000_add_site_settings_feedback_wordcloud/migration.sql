-- CreateEnum
CREATE TYPE "HomePageMode" AS ENUM ('LANDING', 'EVENTS_LIST', 'CUSTOM');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "feedback_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "peak_participants" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "post_event_public" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "post_event_public_until" TIMESTAMP(3),
ADD COLUMN     "post_event_show_feedback" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "post_event_show_materials" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "post_event_show_polls" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "post_event_show_qa" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "recording_consent_text" TEXT,
ADD COLUMN     "recording_delete_after_days" INTEGER,
ADD COLUMN     "recording_duration" INTEGER,
ADD COLUMN     "recording_file_size" BIGINT,
ADD COLUMN     "recording_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recording_published_at" TIMESTAMP(3),
ADD COLUMN     "temp_recording_started_at" TIMESTAMP(3),
ADD COLUMN     "temp_recording_url" TEXT;

-- CreateTable
CREATE TABLE "site_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "site_name" TEXT NOT NULL DEFAULT 'Eventi PA',
    "site_description" TEXT NOT NULL DEFAULT 'Piattaforma per eventi pubblici digitali',
    "organization_name" TEXT NOT NULL DEFAULT '',
    "organization_name_short" TEXT NOT NULL DEFAULT '',
    "organization_url" TEXT NOT NULL DEFAULT '',
    "parent_organization" TEXT NOT NULL DEFAULT '',
    "parent_organization_url" TEXT NOT NULL DEFAULT '',
    "logo_url" TEXT,
    "favicon_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#0066CC',
    "seo_title" TEXT NOT NULL DEFAULT 'Eventi PA',
    "seo_description" TEXT NOT NULL DEFAULT '',
    "seo_image" TEXT,
    "home_page_mode" "HomePageMode" NOT NULL DEFAULT 'LANDING',
    "custom_home_html" TEXT,
    "footer_links" JSONB NOT NULL DEFAULT '[]',
    "privacy_policy_it" TEXT,
    "privacy_policy_en" TEXT,
    "accessibility_it" TEXT,
    "accessibility_en" TEXT,
    "status_page_enabled" BOOLEAN NOT NULL DEFAULT true,
    "guest_access_enabled" BOOLEAN NOT NULL DEFAULT true,
    "public_registration_enabled" BOOLEAN NOT NULL DEFAULT true,
    "jitsi_watermark_url" TEXT,
    "jitsi_watermark_enabled" BOOLEAN NOT NULL DEFAULT true,
    "jitsi_watermark_opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "jitsi_watermark_position" TEXT NOT NULL DEFAULT 'bottom-left',
    "github_url" TEXT,
    "support_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_feedback" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID,
    "guest_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_cloud_rounds" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "prompt" VARCHAR(200) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "duration" INTEGER NOT NULL DEFAULT 120,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "word_cloud_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "word_cloud_submissions" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "registration_id" UUID,
    "guest_id" TEXT,
    "word" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "word_cloud_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_feedback_event_id_idx" ON "event_feedback"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_feedback_event_id_registration_id_key" ON "event_feedback"("event_id", "registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_feedback_event_id_guest_id_key" ON "event_feedback"("event_id", "guest_id");

-- CreateIndex
CREATE INDEX "word_cloud_rounds_event_id_status_idx" ON "word_cloud_rounds"("event_id", "status");

-- AddForeignKey
ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_feedback" ADD CONSTRAINT "event_feedback_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_cloud_rounds" ADD CONSTRAINT "word_cloud_rounds_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "word_cloud_submissions" ADD CONSTRAINT "word_cloud_submissions_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "word_cloud_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
