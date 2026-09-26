-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "home_show_project" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "site_tagline" JSONB NOT NULL DEFAULT '{}';
