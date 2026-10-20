-- Lo stato di titolo e descrizione in ogni lingua dell'evento diversa dalla
-- principale: tradotta in automatico o scritta da una persona, e da quale
-- testo principale viene (lib/text-translation/stato-lingue). Le righe
-- esistenti restano senza stato: i loro testi valgono come scritti da una
-- persona.
-- AlterTable
ALTER TABLE "events" ADD COLUMN     "text_locale_state" JSONB;
