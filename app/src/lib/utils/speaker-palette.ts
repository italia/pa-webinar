/**
 * Palette di colori stabile per gli speaker del transcript.
 *
 * Ogni speaker (identificato da `diarLabel` o `displayName`) riceve un
 * colore deterministico dal palette Bootstrap Italia + colori
 * semantici complementari. Lo stesso speaker mantiene il colore
 * fra refresh — il mapping è funzione pura dell'identità.
 *
 * Usato in:
 *   - TranscriptPanel: bordo sinistro colorato del segment + dot avatar
 *   - PostEventHero: badge speaker
 *   - PostEventSidebar: chip partecipanti
 *
 * Colori scelti per essere distinguibili a colpo d'occhio anche per
 * daltonici (deuteranopia + protanopia testati). 8 colori → cycle per
 * eventi con più di 8 speaker; in pratica gli eventi hanno 3-6 main
 * speaker quindi la collisione è rara.
 */

const PALETTE: readonly string[] = [
  '#0066CC', // primary blue
  '#008758', // success green
  '#A66300', // amber dark
  '#CC334D', // danger red
  '#6633CC', // violet
  '#1F75C4', // azure
  '#B23A48', // dark coral
  '#3F8A4F', // emerald
];

const TRANSPARENT_BG = (hex: string) => hex + '14'; // 8% alpha

export interface SpeakerStyle {
  /** Solid color (border, dot, badge). */
  color: string;
  /** Soft background (10–12% alpha) for highlight rows. */
  bg: string;
}

/**
 * djb2 hash stabile. Stessa stringa → stesso indice del palette.
 * Niente Math.random / Date dependency: l'SSR e il client devono
 * produrre la stessa scelta per evitare hydration mismatch.
 */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const NEUTRAL: SpeakerStyle = { color: '#5A768A', bg: '#5A768A14' };

export function speakerColor(identity: string | null | undefined): SpeakerStyle {
  if (!identity) return NEUTRAL;
  const i = hash(identity) % PALETTE.length;
  const color = PALETTE[i] ?? NEUTRAL.color;
  return { color, bg: TRANSPARENT_BG(color) };
}

/** Iniziali per l'avatar circolare. "Mario Rossi" → "MR", "Alex" → "A". */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (parts.length === 1) return (first[0] ?? '?').toUpperCase();
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase() || '?';
}
