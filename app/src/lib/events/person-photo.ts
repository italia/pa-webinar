/**
 * La foto di una persona dell'evento (EventPersonPhoto nello schema): la
 * persona la manda a chi organizza, che la carica nel wizard. Qui solo ciò che
 * serve anche nel browser: le misure e l'indirizzo da cui si serve. Il
 * salvataggio e la cancellazione stanno in ./person-photo-store.
 */

/** Il lato della foto salvata, in pixel: quadrata, la pagina la mostra in un
 *  cerchio. */
export const PERSON_PHOTO_SIDE = 400;

/** Il tetto del corpo caricato. Il browser manda un JPEG di PERSON_PHOTO_SIDE
 *  di lato già ritagliato: questo è un margine largo per quella misura, non la
 *  misura attesa. */
export const MAX_PERSON_PHOTO_BYTES = 400_000;

/** Il percorso da cui si serve la foto: vale su qualunque origine dell'app.
 *  L'id cambia a ogni foto caricata, quindi un indirizzo vecchio non mostra
 *  quella nuova. */
export function personPhotoPath(id: string): string {
  return `/api/avatar/person/${id}`;
}
