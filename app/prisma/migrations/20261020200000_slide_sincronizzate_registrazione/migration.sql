-- Slide presentate in sala accanto al video pubblicato
-- (lib/presentation/recording-slides.ts): se mostrarle e lo scarto in secondi
-- dei cambi di slide sul video. Solo aggiunte, con valori predefiniti.

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "slides_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "slides_offset_sec" INTEGER NOT NULL DEFAULT 0;
