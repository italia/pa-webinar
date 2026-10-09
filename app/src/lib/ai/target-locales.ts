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

/** Le lingue di traduzione di partenza di un evento: quelle dell'istanza,
 *  senza la lingua in cui si trascrive; null se non ne resta nessuna. Le usa
 *  il wizard dovunque la traduzione si accende da sola (un modello, la
 *  registrazione, l'interruttore della traduzione). */
export function lingueDiPartenzaTraduzione(
  predefinite: string | null | undefined,
  esclusa: string = SOURCE_LANGUAGE_FALLBACK,
): string | null {
  return parseLocaleList(predefinite).filter((c) => c !== esclusa).join(',') || null;
}
