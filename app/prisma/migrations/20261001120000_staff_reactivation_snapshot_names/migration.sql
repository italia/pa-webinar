-- AlterTable
ALTER TABLE "staff_accounts" ADD COLUMN     "reactivated_at" TIMESTAMP(3);


-- Le registrazioni gia' archiviate (output AI eliminati) conservavano nello
-- snapshot dei modelli i nomi dei parlanti e delle voci del doppiaggio: da ora
-- la pulizia li toglie, e questo passo li toglie anche a quelle archiviate prima.
UPDATE "recordings"
SET "pipeline_snapshot" = jsonb_set(
  "pipeline_snapshot",
  '{speakers}',
  (SELECT COALESCE(jsonb_agg(
            CASE WHEN jsonb_typeof(s) = 'object' THEN s || '{"displayName": null}'::jsonb ELSE s END
          ), '[]'::jsonb)
     FROM jsonb_array_elements("pipeline_snapshot"->'speakers') AS s)
)
WHERE "status" = 'ARCHIVED'
  AND jsonb_typeof("pipeline_snapshot"->'speakers') = 'array';

UPDATE "recordings"
SET "pipeline_snapshot" = jsonb_set(
  "pipeline_snapshot",
  '{voiceAssignments}',
  (SELECT COALESCE(jsonb_agg(
            CASE WHEN jsonb_typeof(v) = 'object' THEN v || '{"displayName": null}'::jsonb ELSE v END
          ), '[]'::jsonb)
     FROM jsonb_array_elements("pipeline_snapshot"->'voiceAssignments') AS v)
)
WHERE "status" = 'ARCHIVED'
  AND jsonb_typeof("pipeline_snapshot"->'voiceAssignments') = 'array';
