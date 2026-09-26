-- Anteprima dei link condivisi: cosa mostrare nella scheda generata per
-- OpenGraph. Additiva, con valori predefiniti che riproducono la scheda
-- completa — un'installazione che non tocca niente ottiene l'anteprima piu'
-- informativa, e chi vuole meno la riduce dal pannello.
ALTER TABLE "site_settings"
  ADD COLUMN "og_card_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "og_show_poster" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "og_show_date" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "og_show_speakers" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "og_show_organization" BOOLEAN NOT NULL DEFAULT true;
