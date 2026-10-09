/**
 * Chiavi dei cataloghi che hanno cambiato nome: la personalizzazione salvata
 * dall'amministrazione con il nome vecchio (`SiteSetting.translationOverrides`)
 * vale per quello nuovo, finché per quello nuovo non ce n'e' una sua.
 *
 * Senza, un testo scritto dall'amministrazione — spesso un testo legale, come
 * quello sulla registrazione — sparirebbe in silenzio all'aggiornamento, e al
 * suo posto comparirebbe quello predefinito.
 */
export const CHIAVI_RINOMINATE: Readonly<Record<string, string>> = {
  // Il testo sulla registrazione: era la finestra prima della sala, ora e' la
  // spiegazione sopra la casella del consenso in sala d'attesa.
  'live.recordingConsentTitle': 'waiting.recordingConsentTitle',
  'live.recordingConsent': 'waiting.recordingConsentIntro',
};

export function conChiaviRinominate<T>(
  overrides: Readonly<Record<string, T>>,
): Record<string, T | string> {
  const out: Record<string, T | string> = { ...overrides };
  for (const [vecchia, nuova] of Object.entries(CHIAVI_RINOMINATE)) {
    const valore = overrides[vecchia];
    if (typeof valore === 'string' && valore.trim() && overrides[nuova] === undefined) {
      out[nuova] = valore;
    }
  }
  return out;
}
