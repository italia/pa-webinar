// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

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

/**
 * Varianti di un testo personalizzabile: finche' non ne hanno una loro, valgono
 * con la personalizzazione del testo di partenza. Un testo legale scritto
 * dall'amministrazione non lascia il posto a quello predefinito solo perche'
 * l'evento ne usa una variante.
 */
export const VARIANTI_DI_TESTO: Readonly<Record<string, string>> = {
  'waiting.recordingConsentIntroAnonymous': 'waiting.recordingConsentIntro',
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
  for (const [variante, testo] of Object.entries(VARIANTI_DI_TESTO)) {
    const valore = out[testo];
    if (typeof valore === 'string' && valore.trim() && out[variante] === undefined) {
      out[variante] = valore;
    }
  }
  return out;
}
