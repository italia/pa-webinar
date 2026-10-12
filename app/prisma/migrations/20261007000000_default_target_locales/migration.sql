-- Lingue di traduzione predefinite: inglese, francese, spagnolo e tedesco
-- (prima inglese e francese).
--
-- Un evento con la traduzione accesa e senza lingue proprie usa quelle
-- dell'istanza al momento della post-produzione: prima di cambiarle, quegli
-- eventi ricevono le lingue che stavano usando, cosi' nessun evento gia'
-- creato si trova a tradurre (e doppiare) in piu' lingue di prima.
UPDATE "events" AS e
SET "ai_target_locales" = s."ai_default_target_locales"
FROM "site_settings" AS s
WHERE e."ai_translation_enabled" = true
  AND e."ai_target_locales" IS NULL
  AND s."ai_default_target_locales" = 'en,fr';

-- Lo stesso per i modelli: una serie che crea eventi da un modello con la
-- traduzione accesa e senza lingue proprie continua con le lingue di prima.
UPDATE "event_templates" AS t
SET "ai_target_locales" = s."ai_default_target_locales"
FROM "site_settings" AS s
WHERE t."ai_translation_enabled" = true
  AND t."ai_target_locales" IS NULL
  AND s."ai_default_target_locales" = 'en,fr';

ALTER TABLE "site_settings" ALTER COLUMN "ai_default_target_locales" SET DEFAULT 'en,fr,es,de';

-- Le istanze rimaste sul vecchio predefinito passano al nuovo, che vale per
-- gli eventi e i modelli che si creano da qui in avanti.
UPDATE "site_settings" SET "ai_default_target_locales" = 'en,fr,es,de' WHERE "ai_default_target_locales" = 'en,fr';
