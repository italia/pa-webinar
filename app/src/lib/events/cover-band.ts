/**
 * La copertina nella pagina dell'evento: larga quanto il contenuto del
 * contenitore e alta al massimo 340 px o il 38% della finestra
 * (`.event-cover` in globals.scss). Sugli schermi larghi diventa una fascia
 * con l'immagine intera al centro: il ritaglio e l'anteprima del wizard la
 * mostrano con la forma che ha su uno schermo largo.
 */

/** I contenitori di Bootstrap Italia, dal punto di rottura in su. */
const CONTENITORI: ReadonlyArray<readonly [number, number]> = [
  [1400, 1320],
  [1200, 1176],
  [992, 960],
  [768, 720],
  [576, 540],
];
/** Il margine interno del contenitore e il bordo della scheda. */
const MARGINI = 24 + 2;
const ALTEZZA_MAX = 340;
const QUOTA_FINESTRA = 0.38;
/** Lo schermo largo di riferimento quando quello di chi prepara e' stretto. */
const SCHERMO_LARGO = { width: 1366, height: 768 };

function larghezzaCopertina(larghezzaFinestra: number): number {
  const contenitore =
    CONTENITORI.find(([da]) => larghezzaFinestra >= da)?.[1] ?? larghezzaFinestra;
  return contenitore - MARGINI;
}

/** Larghezza diviso altezza della copertina su uno schermo largo: quello di
 *  chi prepara se lo e', altrimenti un portatile comune. */
export function rapportoFasciaCopertina(finestra?: {
  width: number;
  height: number;
}): number {
  const f = finestra && finestra.width >= 1200 ? finestra : SCHERMO_LARGO;
  const larghezza = larghezzaCopertina(f.width);
  const altezza = Math.min((larghezza * 9) / 16, ALTEZZA_MAX, f.height * QUOTA_FINESTRA);
  return larghezza / Math.max(1, altezza);
}
