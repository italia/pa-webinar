/**
 * L'aspetto di un personaggio della piazza: ogni parte si sceglie da sola
 * (pelle, capelli, vestiti, cappello, occhiali, colori). I tre stili di
 * partenza — maschile, femminile, non dichiarato — sono solo scorciatoie che
 * riempiono le parti: dopo, ognuno cambia quello che vuole, e lo stile scelto
 * non viaggia in rete (agli altri arriva solo il disegno).
 *
 * Niente Phaser qui: lo usano anche la pagina che ospita la piazza (l'editor
 * del personaggio, l'anteprima) e l'adattatore delle presenze.
 */

/** Un colore con la sua ombra, e il nome (chiave di traduzione). */
export interface Tinta {
  nome: string;
  colore: string;
  ombra: string;
}

export interface TintaPelle {
  colore: string;
  ombra: string;
  luce: string;
  bocca: string;
  occhi: string;
}

export const PELLI: readonly TintaPelle[] = [
  { colore: '#ffdcc0', ombra: '#f2b896', luce: '#ffe9d6', bocca: '#e39a80', occhi: '#3b2a2a' },
  { colore: '#ffc999', ombra: '#f1b089', luce: '#ffd8b5', bocca: '#e29779', occhi: '#3b2a2a' },
  { colore: '#e8b07f', ombra: '#cf9466', luce: '#f2c49a', bocca: '#c27a5c', occhi: '#2e2020' },
  { colore: '#c68642', ombra: '#a86d34', luce: '#d79a5b', bocca: '#99573a', occhi: '#2a1c1a' },
  { colore: '#8d5524', ombra: '#734419', luce: '#a2683a', bocca: '#673a1d', occhi: '#1c1212' },
  { colore: '#6b4528', ombra: '#57381f', luce: '#7f5735', bocca: '#47291a', occhi: '#100806' },
];

export const COLORI_CAPELLI: readonly Tinta[] = [
  { nome: 'nero', colore: '#3a2c2a', ombra: '#261c1a' },
  { nome: 'castanoScuro', colore: '#5b3a29', ombra: '#462c1f' },
  { nome: 'castano', colore: '#8a5a35', ombra: '#6f4628' },
  { nome: 'ramato', colore: '#b8552f', ombra: '#94431f' },
  { nome: 'fulvo', colore: '#dc8652', ombra: '#c57652' },
  { nome: 'biondo', colore: '#f0cf7a', ombra: '#d8b25c' },
  { nome: 'grigio', colore: '#c3c5c9', ombra: '#9fa2a8' },
  { nome: 'blu', colore: '#4f7fd9', ombra: '#3d66b5' },
  { nome: 'rosa', colore: '#ef8fb3', ombra: '#d4739a' },
];

/** I colori dei vestiti. I primi otto sono quelli dei personaggi di prima
 *  (un aspetto vecchio, solo «colore della maglia», si ritrova qui). */
export const COLORI_VESTITI: readonly Tinta[] = [
  { nome: 'blu', colore: '#0066cc', ombra: '#00529f' },
  { nome: 'rosso', colore: '#d9364f', ombra: '#b52a40' },
  { nome: 'verde', colore: '#008758', ombra: '#006b46' },
  { nome: 'viola', colore: '#7b5aae', ombra: '#634790' },
  { nome: 'giallo', colore: '#f7a11a', ombra: '#d6880d' },
  { nome: 'bluNotte', colore: '#17324d', ombra: '#0f2235' },
  { nome: 'ardesia', colore: '#5a768a', ombra: '#475e6f' },
  { nome: 'bluPolvere', colore: '#3a5472', ombra: '#2d425a' },
  { nome: 'azzurro', colore: '#5ab4e6', ombra: '#4597c4' },
  { nome: 'bianco', colore: '#f2f4f6', ombra: '#d3d9df' },
  { nome: 'nero', colore: '#33373d', ombra: '#24272b' },
  { nome: 'arancione', colore: '#f26b21', ombra: '#cf5615' },
  { nome: 'rosa', colore: '#e86fa0', ombra: '#c95786' },
];

export const COLORI_SOTTO: readonly Tinta[] = [
  { nome: 'jeans', colore: '#4a6fa5', ombra: '#3a5a88' },
  { nome: 'bluNotte', colore: '#2b3f63', ombra: '#203050' },
  { nome: 'nero', colore: '#3a3e45', ombra: '#2a2d32' },
  { nome: 'grigio', colore: '#8a929b', ombra: '#6f767e' },
  { nome: 'sabbia', colore: '#d6d4aa', ombra: '#c5b993' },
  { nome: 'marrone', colore: '#7a5a3a', ombra: '#62472d' },
  { nome: 'rosso', colore: '#b03a48', ombra: '#8e2e3a' },
  { nome: 'verde', colore: '#3c7a4a', ombra: '#2f603a' },
];

export const COLORI_SCARPE: readonly Tinta[] = [
  { nome: 'marrone', colore: '#8a5530', ombra: '#6b3f22' },
  { nome: 'nero', colore: '#2f3136', ombra: '#1f2024' },
  { nome: 'bianco', colore: '#eef1f4', ombra: '#c8ced4' },
  { nome: 'rosso', colore: '#d9364f', ombra: '#b52a40' },
  { nome: 'blu', colore: '#0066cc', ombra: '#00529f' },
  { nome: 'giallo', colore: '#f7a11a', ombra: '#d6880d' },
  { nome: 'verde', colore: '#008758', ombra: '#006b46' },
  { nome: 'viola', colore: '#7b5aae', ombra: '#634790' },
];

export const CAPELLI = ['corti', 'rasati', 'lunghi', 'coda', 'ricci', 'chignon', 'caschetto', 'calvo'] as const;
export const MAGLIE = ['maglietta', 'felpa', 'camicia', 'giacca', 'vestito'] as const;
export const SOTTO = ['pantaloni', 'pantaloncini', 'gonna'] as const;
export const CAPPELLI = ['nessuno', 'berretto', 'cuffia', 'cappello', 'caschetto', 'cuffie', 'corona'] as const;
export const OCCHIALI = ['nessuno', 'occhiali', 'sole'] as const;
export const STILI = ['neutro', 'maschile', 'femminile'] as const;

export type Stile = (typeof STILI)[number];

/** L'aspetto: ogni campo è un indice nelle liste qui sopra. */
export interface AvatarLook {
  pelle: number;
  capelli: number;
  coloreCapelli: number;
  maglia: number;
  coloreMaglia: number;
  sotto: number;
  coloreSotto: number;
  scarpe: number;
  cappello: number;
  coloreCappello: number;
  occhiali: number;
}

/** Quante scelte ha ogni parte (per i controlli e per la validazione). */
export const SCELTE: Readonly<Record<keyof AvatarLook, number>> = {
  pelle: PELLI.length,
  capelli: CAPELLI.length,
  coloreCapelli: COLORI_CAPELLI.length,
  maglia: MAGLIE.length,
  coloreMaglia: COLORI_VESTITI.length,
  sotto: SOTTO.length,
  coloreSotto: COLORI_SOTTO.length,
  scarpe: COLORI_SCARPE.length,
  cappello: CAPPELLI.length,
  coloreCappello: COLORI_VESTITI.length,
  occhiali: OCCHIALI.length,
};

/** L'ordine dei campi nella codifica: si aggiunge solo in fondo. */
const CAMPI: readonly (keyof AvatarLook)[] = [
  'pelle',
  'capelli',
  'coloreCapelli',
  'maglia',
  'coloreMaglia',
  'sotto',
  'coloreSotto',
  'scarpe',
  'cappello',
  'coloreCappello',
  'occhiali',
];

/** I tre punti di partenza. */
export const PRESET: Readonly<Record<Stile, AvatarLook>> = {
  neutro: {
    pelle: 1,
    capelli: 0,
    coloreCapelli: 2,
    maglia: 1,
    coloreMaglia: 0,
    sotto: 0,
    coloreSotto: 0,
    scarpe: 2,
    cappello: 0,
    coloreCappello: 5,
    occhiali: 0,
  },
  maschile: {
    pelle: 1,
    capelli: 0,
    coloreCapelli: 1,
    maglia: 2,
    coloreMaglia: 8,
    sotto: 0,
    coloreSotto: 1,
    scarpe: 0,
    cappello: 0,
    coloreCappello: 5,
    occhiali: 0,
  },
  femminile: {
    pelle: 1,
    capelli: 2,
    coloreCapelli: 3,
    maglia: 4,
    coloreMaglia: 3,
    sotto: 2,
    coloreSotto: 1,
    scarpe: 3,
    cappello: 0,
    coloreCappello: 1,
    occhiali: 0,
  },
};

export const LOOK_PREDEFINITO: AvatarLook = PRESET.neutro;

/** Riporta ogni campo dentro le scelte possibili (un aspetto salvato da una
 *  versione con più scelte, o scritto a mano). */
export function normalizzaLook(l: Partial<AvatarLook> | null | undefined): AvatarLook {
  const out = { ...LOOK_PREDEFINITO };
  if (!l) return out;
  for (const campo of CAMPI) {
    const v = l[campo];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < SCELTE[campo]) out[campo] = v;
  }
  return out;
}

const VERSIONE = '2';

/**
 * L'aspetto in poche lettere, per il campo `avatarId` delle presenze (al più
 * 16 caratteri): la versione e un carattere in base 36 per campo. Chi usa la
 * codifica di prima (colore e lettere h/g) non la riconosce e mostra un
 * personaggio predefinito, come per ogni avatar che non sa leggere.
 */
export function codificaLook(l: AvatarLook): string {
  return VERSIONE + CAMPI.map((c) => l[c].toString(36)).join('');
}

/** L'aspetto da `avatarId`, o null se non è in questa codifica. */
export function decodificaLook(s: string): AvatarLook | null {
  if (!s.startsWith(VERSIONE) || s.length < 2) return null;
  const parziale: Partial<AvatarLook> = {};
  CAMPI.forEach((campo, i) => {
    const ch = s[i + 1];
    if (ch === undefined) return;
    const v = Number.parseInt(ch, 36);
    if (!Number.isNaN(v)) parziale[campo] = v;
  });
  return normalizzaLook(parziale);
}

/** Dall'aspetto di prima (colore della maglia, caschetto, occhiali). */
export function lookDaVecchio(colore: string, caschetto: boolean, occhiali: boolean): AvatarLook {
  const c = colore.toLowerCase();
  const indice = COLORI_VESTITI.findIndex((t) => t.colore === c);
  return {
    ...LOOK_PREDEFINITO,
    coloreMaglia: indice >= 0 ? indice : LOOK_PREDEFINITO.coloreMaglia,
    cappello: caschetto ? CAPPELLI.indexOf('caschetto') : 0,
    occhiali: occhiali ? 1 : 0,
  };
}

/** Un aspetto a caso ma sempre lo stesso per lo stesso seme (un
 *  identificativo): chi non ha scelto niente non è uguale a nessun altro, e
 *  non cambia faccia a ogni aggiornamento. */
export function lookDaSeme(seme: string): AvatarLook {
  let h = 2166136261;
  for (let i = 0; i < seme.length; i++) h = Math.imul(h ^ seme.charCodeAt(i), 16777619);
  let a = h >>> 0;
  const casuale = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return lookCasuale(casuale);
}

/** L'aspetto di un profilo: quello scelto, altrimenti uno a caso ricavato
 *  dall'identificativo (un profilo di una versione precedente). */
export function lookDi(p: { id: string; look?: Partial<AvatarLook> | null }): AvatarLook {
  return p.look ? normalizzaLook(p.look) : lookDaSeme(p.id);
}

/** Un aspetto a caso: `casuale` restituisce un numero in [0, 1). */
export function lookCasuale(casuale: () => number = Math.random): AvatarLook {
  const scegli = (n: number) => Math.min(n - 1, Math.floor(casuale() * n));
  const l = {} as AvatarLook;
  for (const campo of CAMPI) l[campo] = scegli(SCELTE[campo]);
  // Un cappello ogni tanto, non quasi sempre; la corona è un premio raro.
  if (casuale() < 0.55) l.cappello = 0;
  if (l.cappello === CAPPELLI.indexOf('corona')) l.cappello = 0;
  if (casuale() < 0.6) l.occhiali = 0;
  return l;
}

export function stessoLook(a: AvatarLook, b: AvatarLook): boolean {
  return CAMPI.every((c) => a[c] === b[c]);
}
