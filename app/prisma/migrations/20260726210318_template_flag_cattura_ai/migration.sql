-- AlterTable
ALTER TABLE "event_templates" ADD COLUMN     "ai_dubbing_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ai_target_locales" VARCHAR(200),
ADD COLUMN     "multitrack_recording_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retain_participant_tracks" BOOLEAN NOT NULL DEFAULT false;
