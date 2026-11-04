-- L'elenco di chi partecipa e' nascosto al pubblico finche' chi organizza non
-- sceglie di mostrarlo, anche sugli eventi di prima.
ALTER TABLE "events" ADD COLUMN "participant_list_visible" BOOLEAN NOT NULL DEFAULT false;
