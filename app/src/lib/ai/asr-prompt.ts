/**
 * Il suggerimento iniziale per Whisper (`initial_prompt`): termini del
 * glossario, titolo, ente e relatori. Non viene trascritto: orienta il
 * modello sul vocabolario, cosi' scrive nomi propri e sigle nella forma
 * giusta.
 *
 * Whisper tiene solo gli ultimi ~220 token del suggerimento e taglia da
 * sinistra: i termini del glossario stanno in testa, con poco spazio
 * (GLOSSARY_PROMPT_CHARS), e titolo e relatori in fondo, dove restano.
 */

import { asrPromptTerms, type GlossaryEntry } from '@/lib/ai/glossary';

/** Lo spazio dei termini del glossario nel suggerimento: circa 60 token. */
export const GLOSSARY_PROMPT_CHARS = 240;

/**
 * Costruisce l'initial_prompt per WhisperX dai metadata dell'evento.
 * Aiuta Whisper a riconoscere nomi propri, sigle, organizzazioni
 * specifiche dell'evento (es. una sigla come "PCM" o il nome di un relatore).
 *
 * Cap a 800 caratteri per stare ben dentro la token-window di Whisper
 * (~224 tokens il modello accetta come prompt iniziale).
 */
export function buildAsrInitialPrompt(
  event: {
    title: unknown;
    organizerName: string | null;
    speakersInfo: unknown;
  },
  glossary: GlossaryEntry[] = [],
): string | undefined {
  const localised = (v: unknown): string | undefined => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const key of ['it', 'en', 'fr', 'de', 'es']) {
        const candidate = obj[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate;
      }
    }
    return undefined;
  };
  const parts: string[] = [];
  // In testa, dove il taglio di Whisper li toglie per primi.
  const termini = asrPromptTerms(glossary, GLOSSARY_PROMPT_CHARS);
  if (termini) parts.push(`Termini: ${termini}.`);
  const title = localised(event.title);
  if (title) parts.push(title.trim());
  if (event.organizerName) {
    parts.push(`Organizzato da ${event.organizerName.trim()}.`);
  }
  const speakers = localised(event.speakersInfo);
  if (speakers) parts.push(`Partecipanti e relatori: ${speakers.trim()}.`);
  const out = parts.join(' ').trim();
  if (!out) return undefined;
  // Oltre il limite si taglia la testa, come farebbe Whisper: titolo e
  // relatori restano.
  return out.length > 800 ? out.slice(out.length - 800) : out;
}
