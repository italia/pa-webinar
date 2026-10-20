/**
 * Le lingue di un evento e lo stato del testo (titolo e descrizione) in
 * ciascuna: chi l'ha scritto, se viene dal testo principale di adesso, se
 * verra' tradotto al salvataggio o lo si sta traducendo.
 *
 * Le lingue dell'evento sono un solo elenco (Event.aiTargetLocales): fanno le
 * schede del passo «Evento», le lingue in cui titolo e descrizione si
 * traducono in automatico al salvataggio (quelle attive sul sito, cioe' le
 * lingue della pagina) e, se la traduzione di sottotitoli e sintesi e'
 * accesa, quelle della post-produzione.
 *
 * Lo stato salvato per lingua (Event.textLocaleState) ha due origini sole: il
 * motore di traduzione (MACHINE) o una persona (HUMAN; una lingua riletta e'
 * di una persona). Un testo di una persona non si sostituisce mai da solo.
 *
 * Funzioni pure, usate dal server e dal wizard: l'impronta del testo
 * principale si calcola solo sul server (lib/text-translation/source).
 */

import { CODICE_LINGUA, parseLocaleList } from '@/lib/ai/target-locales';

/** Chi ha scritto il testo di una lingua. */
export type OrigineTesto = 'MACHINE' | 'HUMAN';

export interface StatoTestoLingua {
  origin: OrigineTesto;
  /** L'impronta del testo principale da cui viene, o su cui e' stato riletto. */
  sourceHash: string;
  /** Quando (ISO 8601). */
  at: string;
  /** Il modello che l'ha tradotto, per il testo del motore. */
  model?: string | null;
}

/** Lo stato per lingua, come si salva sull'evento. */
export type StatoTesti = Record<string, StatoTestoLingua>;

/**
 * Lo stato di una lingua come lo dicono la sua scheda e il suo pannello.
 *
 * - `principale`: la lingua principale, scritta da chi crea l'evento.
 * - `onSave`: vuota, o tradotta in automatico da un testo che non c'e' piu':
 *   la si traduce al salvataggio.
 * - `translating` / `waiting`: un lavoro di traduzione la comprende; dopo
 *   `ATTESA_MOTORE_MS` senza risultato si dice che il motore non e' partito.
 * - `machine`: tradotta in automatico dal testo principale di adesso.
 * - `human`: scritta o riletta da una persona sul testo principale di adesso.
 * - `stale`: scritta da una persona su un testo principale che e' cambiato
 *   (o tradotta in automatico, a motore spento).
 * - `failed`: l'ultima traduzione non e' riuscita, e un nuovo salvataggio non
 *   la riproverebbe (stesso testo).
 * - `empty`: vuota, a motore spento: la pagina mostra il testo principale.
 */
export type StatoScheda =
  | 'principale'
  | 'onSave'
  | 'translating'
  | 'waiting'
  | 'machine'
  | 'human'
  | 'stale'
  | 'failed'
  | 'empty';

/** Dopo quanto un lavoro di traduzione ancora aperto si dice «in attesa». */
export const ATTESA_MOTORE_MS = 15 * 60_000;

/** Quanto testo principale il motore traduce al massimo: i limiti del lavoro
 *  TRANSLATE_TEXT (lib/ai/schemas li riprende da qui). Oltre, non si promette
 *  una traduzione. */
export const TITOLO_TRADUCIBILE_MAX = 300;
export const DESCRIZIONE_TRADUCIBILE_MAX = 10_000;

/** Il testo principale sta nei limiti del motore (anche vuoto). */
export function entroILimiti(titolo: string, descrizione: string): boolean {
  return (
    titolo.trim().length <= TITOLO_TRADUCIBILE_MAX &&
    descrizione.trim().length <= DESCRIZIONE_TRADUCIBILE_MAX
  );
}

/** Il testo principale c'e' e sta nei limiti del motore. */
export function testoTraducibile(titolo: string, descrizione: string): boolean {
  return (!!titolo.trim() || !!descrizione.trim()) && entroILimiti(titolo, descrizione);
}

/** I fatti da cui si ricava lo stato di una lingua. */
export interface FattiLingua {
  principale: boolean;
  /** La lingua ha un titolo o una descrizione. */
  conTesto: boolean;
  /** Chi l'ha scritta, se lo si sa (un testo di prima degli stati: null). */
  origine: OrigineTesto | null;
  /** Il testo viene dal testo principale di adesso (vero se non lo si sa). */
  aggiornata: boolean;
  /** La traduzione automatica c'e' per questo evento. */
  motore: boolean;
  /** Da quanto un lavoro di traduzione aperto comprende la lingua; null se nessuno. */
  inTraduzioneDaMs: number | null;
  /** L'ultimo lavoro, sullo stesso testo principale, non e' riuscito per questa lingua. */
  fallita: boolean;
}

export function statoLingua(f: FattiLingua): StatoScheda {
  if (f.principale) return 'principale';
  // Il testo di una persona (anche di prima degli stati) resta suo: nessuna
  // traduzione lo sostituisce, nemmeno una gia' in corso.
  if (f.conTesto && f.origine !== 'MACHINE') return f.aggiornata ? 'human' : 'stale';
  if (f.inTraduzioneDaMs !== null)
    return f.inTraduzioneDaMs > ATTESA_MOTORE_MS ? 'waiting' : 'translating';
  if (f.conTesto && f.aggiornata) return 'machine';
  if (!f.motore) return f.conTesto ? 'stale' : 'empty';
  return f.fallita ? 'failed' : 'onSave';
}

const testo = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Lo stato salvato, se ha la forma attesa: le voci non valide si scartano. */
export function letturaStatoTesti(valore: unknown): StatoTesti {
  if (!valore || typeof valore !== 'object' || Array.isArray(valore)) return {};
  const out: StatoTesti = {};
  for (const [lingua, voce] of Object.entries(valore as Record<string, unknown>)) {
    if (!CODICE_LINGUA.test(lingua) || !voce || typeof voce !== 'object') continue;
    const v = voce as Record<string, unknown>;
    if (v.origin !== 'MACHINE' && v.origin !== 'HUMAN') continue;
    if (typeof v.sourceHash !== 'string' || !v.sourceHash) continue;
    out[lingua] = {
      origin: v.origin,
      sourceHash: v.sourceHash,
      at: testo(v.at),
      ...(typeof v.model === 'string' ? { model: v.model } : {}),
    };
  }
  return out;
}

/** La lingua principale dei testi: quella predefinita del sito. */
export function linguaPrincipale(
  impostazioni: { defaultLocale?: string | null } | null | undefined
): string {
  return impostazioni?.defaultLocale || 'it';
}

/**
 * Le lingue dell'evento: quelle salvate (anche nessuna, `''`) o, se l'evento
 * non ne ha mai scelte (null: un evento di prima, un client dell'API), quelle
 * predefinite del sito.
 */
export function lingueDellEvento(
  salvate: string | null | undefined,
  predefinite: string | null | undefined
): string[] {
  return salvate == null ? parseLocaleList(predefinite) : parseLocaleList(salvate);
}

/** La lingua ha un titolo o una descrizione (non solo spazi). */
export function haTesto(
  lingua: string,
  titoli: Record<string, string> | null | undefined,
  descrizioni: Record<string, string> | null | undefined
): boolean {
  return !!titoli?.[lingua]?.trim() || !!descrizioni?.[lingua]?.trim();
}

/**
 * Le lingue della pagina: quelle dell'evento attive sul sito, senza la
 * principale. Sono le lingue in cui titolo e descrizione si traducono; le
 * altre lingue dell'evento valgono solo per sottotitoli e sintesi.
 */
export function lingueDellaPagina(
  lingueEvento: readonly string[],
  attive: readonly string[],
  principale: string
): string[] {
  return lingueEvento.filter((l) => l !== principale && attive.includes(l));
}

/**
 * Le lingue da tradurre al salvataggio: quelle della pagina senza testo, e
 * quelle tradotte in automatico da un testo principale che non c'e' piu'.
 * Mai una lingua scritta da una persona, ne' un testo di prima degli stati.
 */
export function lingueDaTradurre(opts: {
  pagina: readonly string[];
  titoli: Record<string, string>;
  descrizioni: Record<string, string>;
  stato: StatoTesti;
  impronta: string;
}): string[] {
  return [...new Set(opts.pagina)]
    .filter((l) => {
      if (!haTesto(l, opts.titoli, opts.descrizioni)) return true;
      const s = opts.stato[l];
      return s?.origin === 'MACHINE' && s.sourceHash !== opts.impronta;
    })
    .sort();
}

/** Due elenchi di lingue con le stesse lingue, in qualunque ordine. */
export function stesseLingue(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((l, i) => l === y[i]);
}

/**
 * Le lingue il cui testo e' del motore di traduzione, non ancora riletto da
 * una persona: la pagina pubblica le mostra con l'avviso «Traduzione
 * automatica». Mai la lingua principale (lo stato di una lingua diventata
 * principale non vale piu').
 */
export function lingueTradotteInAutomatico(
  stato: unknown,
  titoli: Record<string, string> | null | undefined,
  descrizioni: Record<string, string> | null | undefined,
  principale: string
): string[] {
  return Object.entries(letturaStatoTesti(stato))
    .filter(
      ([l, s]) =>
        l !== principale && s.origin === 'MACHINE' && haTesto(l, titoli, descrizioni)
    )
    .map(([l]) => l)
    .sort();
}
