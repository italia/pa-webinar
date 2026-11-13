-- L'elenco dei partecipanti segue il formato: gli eventi in cui chi partecipa
-- parla o si mostra continuano a vederlo.
UPDATE "events" SET "participant_list_visible" = true
WHERE "participants_can_unmute" OR "participants_can_start_video";
