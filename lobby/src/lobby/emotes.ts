import type { EmoteType } from './ports/types';

/** I gesti della piazza: il glifo che compare sopra l'avatar e il tasto che lo
 *  fa da tastiera. Un posto solo per la scena, i tasti e la pagina che ospita
 *  la piazza (la barra dei gesti). */
export const EMOTE_GLYPH: Record<EmoteType, string> = {
  wave: '👋',
  heart: '❤️',
  clap: '👏',
  laugh: '😄',
  idea: '💡',
  caffe: '☕',
};

/** I gesti della barra, con il loro tasto. Il caffè no: si prende al caffè. */
export const EMOTE_BARRA = ['wave', 'heart', 'clap', 'laugh', 'idea'] as const satisfies readonly EmoteType[];

export const EMOTE_KEY: Record<(typeof EMOTE_BARRA)[number], string> = {
  wave: 'e',
  heart: 'h',
  clap: 'c',
  laugh: 'r',
  idea: 'i',
};

/** Il gesto di un tasto, o null. */
export function emoteForKey(key: string): EmoteType | null {
  const k = key.toLowerCase();
  for (const [tipo, tasto] of Object.entries(EMOTE_KEY) as [EmoteType, string][]) {
    if (tasto === k) return tipo;
  }
  return null;
}
