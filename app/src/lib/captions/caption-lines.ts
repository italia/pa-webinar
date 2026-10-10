/**
 * Le righe dei sottotitoli live da mostrare in sala, ricavate dai frammenti
 * che l'IFrame API inoltra (`transcriptionChunkReceived`).
 *
 * Ogni frase ha un id: i frammenti successivi della stessa frase ne
 * sostituiscono il testo (il servizio manda sempre la frase intera). Si
 * mostrano le ultime frasi, al massimo `maxLines`; una frase conclusa resta
 * a schermo qualche secondo, il tempo di leggerla, poi sparisce.
 */

import type { JitsiTranscriptionChunk } from '@/types/jitsi';

export interface CaptionLine {
  id: string;
  /** Endpoint di chi parla. */
  speakerId: string | null;
  text: string;
  final: boolean;
  /** Ultimo aggiornamento (ms). */
  at: number;
}

export const CAPTION_MAX_LINES = 2;
/** Quanto resta a schermo una frase conclusa. */
export const CAPTION_FINAL_TTL_MS = 6000;
/** Una frase provvisoria ferma da tanto è un residuo: il definitivo non arriverà più. */
export const CAPTION_STALE_MS = 15000;

export function chunkText(chunk: JitsiTranscriptionChunk): { text: string; final: boolean } {
  if (typeof chunk.final === 'string') return { text: chunk.final.trim(), final: true };
  const text = `${chunk.stable ?? ''}${chunk.unstable ?? ''}`.trim();
  return { text, final: false };
}

/** Applica un frammento; restituisce un nuovo elenco (immutabile). */
export function applyChunk(
  lines: CaptionLine[],
  chunk: JitsiTranscriptionChunk,
  now: number,
): CaptionLine[] {
  if (!chunk.messageID) return lines;
  const { text, final } = chunkText(chunk);
  const others = lines.filter((l) => l.id !== chunk.messageID);
  if (!text) return others;
  const line: CaptionLine = {
    id: chunk.messageID,
    speakerId: chunk.participant?.id ?? null,
    text,
    final,
    at: now,
  };
  // Una frase già a schermo resta al suo posto; una nuova va in fondo.
  const index = lines.findIndex((l) => l.id === chunk.messageID);
  const next = index >= 0 ? lines.map((l) => (l.id === chunk.messageID ? line : l)) : [...others, line];
  return prune(next, now);
}

/** Toglie le frasi lette e i residui, tiene le ultime `maxLines`. */
export function prune(lines: CaptionLine[], now: number, maxLines = CAPTION_MAX_LINES): CaptionLine[] {
  const live = lines.filter((l) =>
    l.final ? now - l.at < CAPTION_FINAL_TTL_MS : now - l.at < CAPTION_STALE_MS,
  );
  return live.slice(-maxLines);
}
