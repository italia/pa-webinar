/**
 * Il testo di partenza di una traduzione automatica di titolo e descrizione,
 * e la sua impronta.
 *
 * L'impronta dice da quale testo principale viene il testo di un'altra lingua:
 * quello tradotto in automatico (Event.textLocaleState, lavoro TRANSLATE_TEXT)
 * e quello riletto da una persona. Quando il testo principale cambia,
 * l'impronta cambia e quella lingua risulta da aggiornare. Si calcola solo sul
 * server: il browser confronta il testo del modulo con quello caricato.
 */
import { createHash } from 'crypto';

export interface TestoSorgente {
  sourceLanguage: string;
  title: string;
  description: string;
}

/** Il testo di partenza nella lingua `lingua`, dai campi multilingue. */
export function testoSorgente(
  lingua: string,
  titoli: Record<string, string> | null | undefined,
  descrizioni: Record<string, string> | null | undefined
): TestoSorgente {
  return {
    sourceLanguage: lingua,
    title: (titoli?.[lingua] ?? '').trim(),
    description: (descrizioni?.[lingua] ?? '').trim(),
  };
}

/** L'impronta SHA-256 (esadecimale) del testo di partenza. */
export function improntaSorgente(sorgente: TestoSorgente): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        sorgente.sourceLanguage,
        sorgente.title.trim(),
        sorgente.description.trim(),
      ])
    )
    .digest('hex');
}
