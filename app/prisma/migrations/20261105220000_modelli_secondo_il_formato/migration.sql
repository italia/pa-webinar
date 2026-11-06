-- I modelli di sistema partono dai valori del loro formato: destinazione del
-- video, nomi del pubblico, domande dopo l'evento e rubrica proposta. La
-- riunione e il corso restano fra chi si conosce: video riservato, nomi reali,
-- domande non pubblicate, rubrica non proposta. Il webinar e la conferenza
-- stampa sono pubblici, ma alla conferenza chi fa domande compare con il
-- proprio nome. Chi conduce sceglie come tutti: la colonna resta spenta.
--
-- Si toccano solo i modelli di sistema mai modificati (`updated_at` entro un
-- secondo da `created_at`, come nelle migrazioni precedenti sui modelli), e
-- `updated_at` non si aggiorna. Un modello modificato resta com'era, un modello
-- cancellato non torna, gli eventi gia' creati non cambiano. La «Riunione di
-- lavoro» non accende la registrazione: la destinazione vale se la si accende.

UPDATE "event_templates"
SET "recording_destination" = 'PUBLIC',
    "audience_anonymous" = true,
    "post_event_show_qa" = true,
    "offer_address_book" = true
WHERE "name" = 'Webinar pubblico'
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';

UPDATE "event_templates"
SET "recording_destination" = 'PUBLIC',
    "audience_anonymous" = false,
    "post_event_show_qa" = true,
    "offer_address_book" = true
WHERE "name" IN ('Evento partecipativo', 'Conferenza stampa')
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';

UPDATE "event_templates"
SET "recording_destination" = 'REGISTRANTS',
    "audience_anonymous" = false,
    "post_event_show_qa" = false,
    "offer_address_book" = false
WHERE "name" IN ('Riunione di lavoro', 'Corso di formazione')
  AND "is_system" = true
  AND "updated_at" <= "created_at" + interval '1 second';
