// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * La forma di un nickname: le regole che non chiedono il database, le stesse
 * nel browser (per dirlo subito, accanto al campo) e sul server, che le
 * riapplica sempre (lib/live/nickname).
 *
 * Una sola parola, perche' in chat le menzioni («@…») si riconoscono dalla
 * prima parola del nome (lib/chat/linkify): un nickname di due parole sarebbe
 * menzionato con la prima, e quella potrebbe essere di un altro. La parola
 * comincia con una lettera, finisce con una lettera o una cifra, e in mezzo
 * ammette lettere, cifre e i separatori `.`, `_`, `-` (mai due di fila): la
 * stessa forma della maniglia di una menzione. Niente spazi, simboli,
 * caratteri di controllo o invisibili.
 *
 * Le lettere sono di una sola scrittura: latina, greca o cirillica non si
 * mescolano fra loro ne' con altre. Una «а» cirillica in mezzo a lettere
 * latine e' il modo piu' semplice per sembrare un altro.
 *
 * Il confronto (unicita', somiglianza con chi conduce, parole riservate) non
 * distingue maiuscole, accenti e separatori: «Pippo_1», «pippo1» e «Pìppo-1»
 * sono lo stesso nickname.
 */

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 24;

/**
 * Perche' un nickname non va:
 * - `length`: piu' corto di NICKNAME_MIN o piu' lungo di NICKNAME_MAX;
 * - `format`: non e' una parola sola nella forma ammessa;
 * - `scripts`: mescola scritture diverse;
 * - `reserved`: contiene una parola della piattaforma (un ruolo, lo pseudonimo);
 * - `host`: somiglia al nome di chi conduce l'evento;
 * - `taken`: nell'evento lo usa gia' un altro.
 */
export type MotivoNickname =
  'length' | 'format' | 'scripts' | 'reserved' | 'host' | 'taken';

const FORMA = /^\p{L}(?:[\p{L}\p{Nd}._-]*[\p{L}\p{Nd}])?$/u;
const SEPARATORI_DI_FILA = /[._-]{2}/;
/** Lettere che non si vedono, come i riempitivi hangul: un nickname vuoto a
 *  vederlo. */
const INVISIBILI = /\p{Default_Ignorable_Code_Point}/u;

/** Il nickname come si salva e si mostra: forma canonica, senza spazi ai lati.
 *  NFKC porta le cifre e le lettere «larghe» o in apice alla loro forma piana. */
export function normalizzaNickname(raw: string): string {
  return raw.normalize('NFKC').trim();
}

/** Una lettera latina, greca o cirillica: le scritture che si confondono. */
const SCRITTURE = [
  /\p{Script=Latin}/u,
  /\p{Script=Greek}/u,
  /\p{Script=Cyrillic}/u,
] as const;

function scritturaMista(nick: string): boolean {
  const lettere = [...nick].filter((c) => /\p{L}/u.test(c));
  const usate = SCRITTURE.filter((s) => lettere.some((c) => s.test(c)));
  if (usate.length > 1) return true;
  // Una di quelle tre insieme a una scrittura diversa.
  const [unica] = usate;
  return !!unica && lettere.some((c) => !unica.test(c));
}

/** Il primo difetto di forma, o null. `nick` gia' normalizzato. */
export function difettoDiForma(nick: string): MotivoNickname | null {
  const lunghezza = [...nick].length;
  if (lunghezza < NICKNAME_MIN || lunghezza > NICKNAME_MAX) return 'length';
  if (!FORMA.test(nick) || SEPARATORI_DI_FILA.test(nick) || INVISIBILI.test(nick))
    return 'format';
  if (scritturaMista(nick)) return 'scripts';
  return null;
}

/** La forma di confronto: senza accenti, minuscola, solo lettere e cifre. */
export function formaDiConfronto(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Una parola di un nome, da qui in su, conta da sola. */
const PAROLA_MINIMA = 3;
/** Un nome intero, da qui in su, non si puo' nemmeno contenere. */
const NOME_MINIMO = 4;

/**
 * Il nickname somiglia a una di queste persone? Vale se coincide con il nome
 * intero o con una sua parola di almeno tre lettere («Mario» per «Mario
 * Rossi»: in chat lo menzionerebbe chi cerca lui), o se contiene il nome
 * intero di almeno due parole («MarioRossi99»). Un nome di una parola sola
 * conta solo uguale: «Giovanna» non imita «Anna».
 */
export function imitaUnNome(nick: string, nomi: readonly string[]): boolean {
  const n = formaDiConfronto(nick);
  if (!n) return false;
  for (const nome of nomi) {
    const intero = formaDiConfronto(nome);
    if (!intero) continue;
    const parole = nome
      .split(/[\s'’.,_-]+/u)
      .map(formaDiConfronto)
      .filter(Boolean);
    if (n === intero) return true;
    if (parole.length >= 2 && intero.length >= NOME_MINIMO && n.includes(intero))
      return true;
    if (parole.some((p) => p.length >= PAROLA_MINIMA && n === p)) return true;
  }
  return false;
}

/**
 * Il nickname contiene una parola riservata della piattaforma? Le parole di
 * almeno cinque lettere non si possono nemmeno contenere («IlModeratore»,
 * «Relatore2»); le piu' corte non si possono usare da sole ne' con un numero
 * in fondo («Host», «Host1»), ma restano dentro altre parole («Hostess»).
 */
export function usaUnaParolaRiservata(nick: string, parole: readonly string[]): boolean {
  const n = formaDiConfronto(nick);
  return parole.some((parola) => {
    const p = formaDiConfronto(parola);
    if (!p) return false;
    if (p.length >= 5) return n.includes(p);
    return n === p || (n.startsWith(p) && /^\p{Nd}+$/u.test(n.slice(p.length)));
  });
}

/** Le alternative da proporre a chi trova il nickname occupato: lo stesso con
 *  un numero in fondo, dentro la lunghezza massima. */
export function alternativeNickname(nick: string, quante = 12): string[] {
  const base = nick.replace(/[\p{Nd}._-]+$/u, '') || nick;
  const out: string[] = [];
  for (let i = 2; out.length < quante && i < 100; i++) {
    const coda = String(i);
    const testa = [...base].slice(0, NICKNAME_MAX - coda.length).join('');
    const candidato = `${testa}${coda}`;
    if (candidato !== nick) out.push(candidato);
  }
  return out;
}
