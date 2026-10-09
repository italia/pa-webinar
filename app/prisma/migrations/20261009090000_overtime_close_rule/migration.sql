-- Fuori orario: il tetto per una sala occupata passa da 15 a 60 minuti, e una
-- sala vuota oltre la fine si chiude dopo 20 minuti.
--
-- Il valore 15 era il predefinito con il significato vecchio («chiudi a
-- endsAt+15 comunque»): con il significato nuovo («tetto per una sala ancora
-- occupata») un'installazione rimasta sul predefinito passa al nuovo
-- predefinito. Un valore scelto diverso da 15 resta com'è.
ALTER TABLE "site_settings" ALTER COLUMN "event_grace_period_minutes" SET DEFAULT 60;
UPDATE "site_settings" SET "event_grace_period_minutes" = 60 WHERE "event_grace_period_minutes" = 15;

ALTER TABLE "site_settings" ADD COLUMN "event_overtime_empty_minutes" INTEGER NOT NULL DEFAULT 20;
