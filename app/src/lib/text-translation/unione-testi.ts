/**
 * Titolo, descrizione e stato per lingua da scrivere quando si salva un
 * evento (POST /api/events, PUT /api/events/[param]).
 *
 * Il wizard manda `textEdits.touched`, le lingue diverse dalla principale che
 * chi scrive ha toccato in questa pagina (una modifica, «Segna come riletta»,
 * «È ancora corretta», una lingua tolta): di quelle vale il testo del modulo,
 * che diventa di una persona; di tutte le altre resta il testo salvato, con il
 * suo stato. Cosi' una traduzione arrivata mentre il wizard era aperto non si
 * cancella con il testo che il modulo aveva caricato prima. Una lingua tolta
 * dalle lingue dell'evento perde testo e stato.
 *
 * Senza `textEdits` (un client dell'API, una scheda di prima) il testo
 * inviato sostituisce tutto, come sempre; le lingue il cui testo cambia
 * diventano di una persona.
 *
 * Un testo salvato prima che esistesse lo stato resta di una persona, ma
 * prende l'impronta del testo principale che c'era prima di questo
 * salvataggio: se il testo principale cambia adesso, quella lingua risulta da
 * aggiornare invece di sembrare aggiornata per sempre.
 *
 * Funzioni pure: l'impronta del testo principale la calcola chi chiama.
 */
import { pruneEmptyTranslations } from '@/lib/utils/locale';

import { haTesto, type StatoTesti } from './stato-lingue';

type Testi = Record<string, string>;

export interface TestiEvento {
  title: Testi;
  description: Testi;
  stato: StatoTesti;
}

const comeTesti = (v: unknown): Testi =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? pruneEmptyTranslations(v as Record<string, string>)
    : {};

/** Lo stato «scritto da una persona» sul testo principale di adesso. */
function diUnaPersona(impronta: string, ora: Date) {
  return { origin: 'HUMAN' as const, sourceHash: impronta, at: ora.toISOString() };
}

/**
 * I testi di un evento nuovo: ogni lingua con un testo, oltre alla
 * principale, e' di chi la scrive.
 */
export function testiDiUnEventoNuovo(opts: {
  principale: string;
  title: unknown;
  description: unknown;
  impronta: string;
  ora: Date;
}): TestiEvento {
  const title = comeTesti(opts.title);
  const description = comeTesti(opts.description);
  const stato: StatoTesti = {};
  for (const l of new Set([...Object.keys(title), ...Object.keys(description)])) {
    if (l !== opts.principale) stato[l] = diUnaPersona(opts.impronta, opts.ora);
  }
  return { title, description, stato };
}

/**
 * I testi da scrivere salvando un evento che esiste.
 *
 * `inviati` sono titolo e descrizione della richiesta (undefined quelli non
 * inviati: restano quelli salvati); `toccate` e' `textEdits.touched`, o null
 * senza `textEdits`. `lingueTolte` sono le lingue uscite dalle lingue
 * dell'evento con questo salvataggio (valgono solo con `textEdits`).
 */
export function unisciTesti(opts: {
  principale: string;
  salvati: { title: unknown; description: unknown; stato: StatoTesti };
  inviati: { title?: unknown; description?: unknown };
  toccate: readonly string[] | null;
  lingueTolte: readonly string[];
  /** L'impronta del testo principale che si sta salvando. */
  impronta: string;
  /** L'impronta del testo principale salvato prima di questo salvataggio. */
  improntaPrecedente: string;
  ora: Date;
}): TestiEvento {
  const { principale, impronta, ora } = opts;
  // Lo stato salvato, o per un testo di prima degli stati quello di una
  // persona sul testo principale di prima.
  const statoSalvato = (l: string) =>
    opts.salvati.stato[l] ?? {
      origin: 'HUMAN' as const,
      sourceHash: opts.improntaPrecedente,
      at: ora.toISOString(),
    };
  const salvatiTitolo = comeTesti(opts.salvati.title);
  const salvataDescrizione = comeTesti(opts.salvati.description);
  const inviatoTitolo =
    opts.inviati.title === undefined ? salvatiTitolo : comeTesti(opts.inviati.title);
  const inviataDescrizione =
    opts.inviati.description === undefined
      ? salvataDescrizione
      : comeTesti(opts.inviati.description);

  const lingue = new Set([
    ...Object.keys(salvatiTitolo),
    ...Object.keys(salvataDescrizione),
    ...Object.keys(inviatoTitolo),
    ...Object.keys(inviataDescrizione),
    ...Object.keys(opts.salvati.stato),
  ]);
  const title: Testi = {};
  const description: Testi = {};
  const stato: StatoTesti = {};
  const scrivi = (l: string, t: string | undefined, d: string | undefined) => {
    if (t) title[l] = t;
    if (d) description[l] = d;
  };

  for (const l of lingue) {
    // La lingua principale viene sempre da chi salva, e non ha uno stato.
    if (l === principale) {
      scrivi(l, inviatoTitolo[l], inviataDescrizione[l]);
      continue;
    }
    if (opts.toccate === null) {
      // Senza textEdits: il testo inviato vale per tutte le lingue; dove
      // cambia, e' di una persona.
      scrivi(l, inviatoTitolo[l], inviataDescrizione[l]);
      const cambiata =
        (inviatoTitolo[l] ?? '') !== (salvatiTitolo[l] ?? '') ||
        (inviataDescrizione[l] ?? '') !== (salvataDescrizione[l] ?? '');
      if (!haTesto(l, title, description)) continue;
      stato[l] = cambiata ? diUnaPersona(impronta, ora) : statoSalvato(l);
      continue;
    }
    if (opts.lingueTolte.includes(l)) continue;
    if (opts.toccate.includes(l)) {
      scrivi(l, inviatoTitolo[l], inviataDescrizione[l]);
      if (haTesto(l, title, description)) stato[l] = diUnaPersona(impronta, ora);
      continue;
    }
    // Non toccata: il testo e lo stato salvati, anche se il modulo ne aveva
    // un altro (caricato prima che arrivasse una traduzione).
    scrivi(l, salvatiTitolo[l], salvataDescrizione[l]);
    if (haTesto(l, title, description)) stato[l] = statoSalvato(l);
  }
  return { title, description, stato };
}
