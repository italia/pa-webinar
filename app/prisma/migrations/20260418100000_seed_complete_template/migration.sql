-- Seed a system template that enables every live-interaction feature.
-- Useful as the default for rich webinars / panels where the moderator
-- wants Q&A + chat + polls + reactions + recording on from the start,
-- without ticking each toggle manually in the create form.
--
-- `is_system = true` hides it from the "delete" action in the UI so it
-- isn't accidentally removed by an admin clearing custom templates.

INSERT INTO event_templates (
  name, description, icon,
  qa_enabled, chat_enabled, recording_enabled,
  participants_can_unmute, participants_can_start_video, participants_can_share_screen,
  max_participants, is_system, sort_order,
  created_at, updated_at
) VALUES (
  'Evento interattivo completo',
  'Tutte le funzioni live attive: Q&A, chat, registrazione, reazioni, mic e webcam partecipanti. Per webinar, panel, eventi con interazione intensa.',
  'it-star-full',
  true,  true,  true,
  true,  true,  false,        -- screen share resta fuori: solo il moderatore presenta
  300,   true,  0,
  NOW(),  NOW()
)
ON CONFLICT DO NOTHING;
