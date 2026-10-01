/**
 * Marcatura degli output della post-produzione AI quando lasciano il portale
 * (AI Act, art. 50): nella pagina il badge lo dice a chi legge, ma un file
 * scaricato o un sottotitolo caricato da un altro player viaggiano da soli.
 *
 * La marcatura si aggiunge al momento di servire il file, non nel worker: vale
 * cosi' anche per gli output gia' prodotti, e il file conservato resta quello
 * che il worker rilegge (le traduzioni partono dai sottotitoli conservati).
 */

/** Intestazione HTTP su ogni risposta che serve un output AI. */
export const AI_GENERATED_HEADER = 'X-AI-Generated';
export const AI_GENERATED_HEADER_VALUE = 'true';

const NOTICE =
  'AI-generated content (EU AI Act, Art. 50): produced automatically by the ' +
  'PA Webinar post-production pipeline; it may contain errors, and the ' +
  'recording remains the authoritative source.';

const REVISED = 'Revised by a person after automatic generation.';

/** WebVTT: un blocco NOTE subito dopo l'intestazione, ignorato dai player. */
export function markVtt(vtt: string, opts: { revised?: boolean } = {}): string {
  if (/^NOTE\s*\nai-generated: true/m.test(vtt)) return vtt;
  const note = [
    'NOTE',
    'ai-generated: true',
    `ai-notice: ${NOTICE}`,
    ...(opts.revised ? [`ai-revision: ${REVISED}`] : []),
  ].join('\n');
  const lines = vtt.replace(/^﻿/, '').split('\n');
  // L'intestazione e' la prima riga (WEBVTT con eventuale testo dopo), seguita
  // da righe di metadati fino alla prima riga vuota.
  let end = 1;
  while (end < lines.length && lines[end]!.trim() !== '') end += 1;
  return [...lines.slice(0, end), '', note, ...lines.slice(end)].join('\n');
}

/** Testo piano: una riga d'avviso in testa. */
export function markPlainText(text: string, opts: { revised?: boolean } = {}): string {
  const head = `[${NOTICE}${opts.revised ? ` ${REVISED}` : ''}]`;
  return `${head}\n\n${text}`;
}

/** Markdown: un commento leggibile da macchina e la stessa riga d'avviso. */
export function markMarkdown(md: string, opts: { revised?: boolean } = {}): string {
  const meta = `<!-- ai-generated: true${opts.revised ? '; ai-revision: human' : ''} -->`;
  return `${meta}\n\n_${NOTICE}${opts.revised ? ` ${REVISED}` : ''}_\n\n${md}`;
}
