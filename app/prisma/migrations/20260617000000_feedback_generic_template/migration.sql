-- Seed the system "Feedback generico" question template used as the
-- default POST_EVENT feedback questionnaire. Idempotent (ON CONFLICT DO
-- NOTHING) so it can run safely on every environment via migrate deploy
-- and never clobbers an admin-renamed/edited copy.
--
-- Items (1..5 star LIKERT in the feedback variant + an optional comment):
--   1. Audio/video quality
--   2. Ease of joining the call
--   3. Interest of content/topics
--   4. Free-text comments (optional)
--
-- Fixed UUIDs keep the rows stable and referenceable across deploys.

INSERT INTO "question_templates"
  ("id", "name", "description", "is_system", "sort_order", "created_at", "updated_at")
VALUES
  ('f00dbac0-0000-4000-a000-000000000001',
   'Feedback generico',
   'Domande di feedback generiche mostrate al termine dell''evento.',
   true, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

INSERT INTO "question_items"
  ("id", "template_id", "questionnaire_id", "prompt", "type", "options",
   "scale_min", "scale_max", "scale_min_label", "scale_max_label",
   "required", "sort_order", "created_at", "updated_at")
VALUES
  ('f00dbac0-0000-4000-a000-000000000011',
   'f00dbac0-0000-4000-a000-000000000001', NULL,
   '{"it":"Qualità audio e video","en":"Audio and video quality"}', 'LIKERT', NULL,
   1, 5, '{"it":"Scarsa","en":"Poor"}', '{"it":"Ottima","en":"Excellent"}',
   false, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f00dbac0-0000-4000-a000-000000000012',
   'f00dbac0-0000-4000-a000-000000000001', NULL,
   '{"it":"Facilità di accesso alla call","en":"Ease of joining the call"}', 'LIKERT', NULL,
   1, 5, '{"it":"Difficile","en":"Difficult"}', '{"it":"Facile","en":"Easy"}',
   false, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f00dbac0-0000-4000-a000-000000000013',
   'f00dbac0-0000-4000-a000-000000000001', NULL,
   '{"it":"Interesse dei contenuti e degli argomenti trattati","en":"Interest of the content and topics covered"}', 'LIKERT', NULL,
   1, 5, '{"it":"Basso","en":"Low"}', '{"it":"Alto","en":"High"}',
   false, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f00dbac0-0000-4000-a000-000000000014',
   'f00dbac0-0000-4000-a000-000000000001', NULL,
   '{"it":"Commenti e suggerimenti (facoltativo)","en":"Comments and suggestions (optional)"}', 'OPEN_TEXT', NULL,
   NULL, NULL, NULL, NULL,
   false, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;
