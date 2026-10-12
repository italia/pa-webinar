-- I link del pie' di pagina salvati come testo JSON (dal pannello e dal seed
-- delle versioni precedenti) diventano l'elenco JSON che la colonna e lo
-- schema delle impostazioni si aspettano. Un testo che non e' JSON resta com'e':
-- il pannello lo segnala al primo salvataggio, e l'avvio non si blocca.
DO $$
BEGIN
  UPDATE "site_settings"
     SET "footer_links" = ("footer_links" #>> '{}')::jsonb
   WHERE jsonb_typeof("footer_links") = 'string';
EXCEPTION
  WHEN invalid_text_representation THEN
    NULL;
END $$;
