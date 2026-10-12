/**
 * Il contesto di una stanza per il servizio dei sottotitoli live (ADR-018):
 * se trascrivere, in che lingua, e il vocabolario dell'evento.
 *
 * Il vocabolario è lo stesso che guida la post-produzione: i termini del
 * glossario (dell'evento e dell'istanza), l'ente, gli enti organizzatori e le
 * persone dell'evento (moderatori e relatori nominali). Il servizio li usa in
 * due modi: le frasi orientano il riconoscimento con un peso basso (più alto,
 * il motore scrive termini mai detti: misurato con infra/captions/bench), e le
 * forme sbagliate del glossario si correggono nel testo. Nessun dato degli
 * iscritti: in un webinar parlano relatori e moderatori, e chi interviene ha
 * già il nome in sala.
 */

import type { GlossaryEntry } from '@/lib/ai/glossary';

/** Le lingue dell'interfaccia che il modello trascrive, con la variante da chiedergli. */
export const ASR_LOCALES: Record<string, string> = {
  it: 'it-IT',
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-PT',
  nl: 'nl-NL',
  pl: 'pl-PL',
  sv: 'sv-SE',
  cs: 'cs-CZ',
  da: 'da-DK',
  bg: 'bg-BG',
  fi: 'fi-FI',
  hr: 'hr-HR',
  sk: 'sk-SK',
  hu: 'hu-HU',
  ro: 'ro-RO',
  et: 'et-EE',
};

/** Il codice primario di una lingua ("it-IT" → "it"); senza lingua, l'italiano. */
export function primaryLanguageCode(locale: string | null | undefined): string {
  return (locale ?? '').split(/[-_]/)[0]?.toLowerCase() || 'it';
}

/** La lingua da chiedere al motore; per le lingue che non trascrive bene, il riconoscimento automatico. */
export function asrLanguage(locale: string | null | undefined): string {
  return ASR_LOCALES[primaryLanguageCode(locale)] ?? 'auto';
}

export const MAX_PHRASES = 100;
const MAX_PHRASE_CHARS = 80;

/** Frasi da favorire: uniche (senza badare alle maiuscole), non vuote, non troppo lunghe. */
export function buildPhrases(sources: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of sources) {
    const phrase = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!phrase || phrase.length > MAX_PHRASE_CHARS) continue;
    const key = phrase.toLocaleLowerCase('it');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= MAX_PHRASES) break;
  }
  return out;
}

/** Le correzioni del glossario: solo le voci con forme sbagliate note. */
export function aliasRules(glossary: GlossaryEntry[]): Array<{ term: string; aliases: string[] }> {
  return glossary
    .filter((e) => e.aliases.length > 0)
    .map((e) => ({ term: e.term, aliases: e.aliases.slice(0, 20) }));
}

export interface CaptionsContext {
  enabled: boolean;
  /** L'evento tiene la trascrizione dai sottotitoli: il servizio manda al
   *  portale le frasi definitive (Event.captionsTranscriptEnabled). */
  transcript?: boolean;
  language: string;
  phrases: string[];
  aliases: Array<{ term: string; aliases: string[] }>;
}
