-- Engine della sala d'attesa configurabile: default a livello sito
-- (site_settings) + override per-evento (events). Valori: GARDEN (giardino
-- SVG, default storico), GAME (lobby Phaser/videogame), CLASSIC (card statica).

-- CreateEnum
CREATE TYPE "WaitingRoomEngine" AS ENUM ('GARDEN', 'GAME', 'CLASSIC');

-- AlterTable: default a livello sito (esistenti → GARDEN, comportamento invariato)
ALTER TABLE "site_settings" ADD COLUMN "waiting_room_engine" "WaitingRoomEngine" NOT NULL DEFAULT 'GARDEN';

-- AlterTable: override per-evento (NULL = eredita il default del sito)
ALTER TABLE "events" ADD COLUMN "waiting_room_engine" "WaitingRoomEngine";
