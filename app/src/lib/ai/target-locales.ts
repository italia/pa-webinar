/** Le lingue di traduzione predefinite di un'istanza nuova: inglese,
 *  francese, spagnolo e tedesco (SiteSetting.aiDefaultTargetLocales). */
export const DEFAULT_TARGET_LOCALES = 'en,fr,es,de';

/** La lingua in cui la pipeline trascrive quando la registrazione non ne
 *  indica una (Recording.sourceLanguage): e' anche la lingua che non si
 *  offre come traduzione, perche' la pipeline la toglie. */
export const SOURCE_LANGUAGE_FALLBACK = 'it';

const CODICE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;

/** I codici di una stringa `en,fr`, come li legge la pipeline
 *  (lib/ai/providers parseTargetLocales): minuscoli, validi, senza
 *  ripetizioni, nell'ordine in cui sono scritti. */
export function parseLocaleList(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const c = raw.trim().toLowerCase();
    if (CODICE.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}
