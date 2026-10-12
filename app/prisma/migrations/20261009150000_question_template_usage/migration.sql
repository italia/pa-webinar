-- Dove si propone un modello di domande: prima dell'evento (questionario di
-- iscrizione), dopo l'evento (feedback) o in entrambi (NULL). I modelli
-- esistenti restano proponibili ovunque, salvo il feedback generico di
-- sistema, che ha senso solo dopo l'evento. Lo si riconosce come fa
-- l'applicazione: dal nome, fra i modelli di sistema, oltre che dal suo id.

ALTER TABLE "question_templates" ADD COLUMN "usage" "QuestionnairePlacement";

UPDATE "question_templates"
SET "usage" = 'POST_EVENT'
WHERE "id" = 'f00dbac0-0000-4000-a000-000000000001'
   OR ("is_system" = true AND "name" = 'Feedback generico');
