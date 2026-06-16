-- Preset qualità video/audio configurabile: default a livello sito
-- (site_settings) + override per-evento (events). Valori: SAVE_DATA (360p),
-- BALANCED (540p), HIGH (720p, bitrate limitato — default), MAX (1080p).
-- Mappatura sui parametri Jitsi in app/src/lib/jitsi/config.ts.

-- CreateEnum
CREATE TYPE "VideoQuality" AS ENUM ('SAVE_DATA', 'BALANCED', 'HIGH', 'MAX');

-- AlterTable: default a livello sito (esistenti → HIGH, qualità 720p con bitrate cap)
ALTER TABLE "site_settings" ADD COLUMN "video_quality" "VideoQuality" NOT NULL DEFAULT 'HIGH';

-- AlterTable: override per-evento (NULL = eredita il default del sito)
ALTER TABLE "events" ADD COLUMN "video_quality" "VideoQuality";
