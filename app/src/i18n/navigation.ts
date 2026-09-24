import { createNavigation } from 'next-intl/navigation';

import { riconosci, type PercorsoRiconosciuto } from './percorsi';
import { routing } from './routing';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);

/**
 * La forma d'indirizzo accettata da `router.push`, che e' anche un `href`
 * valido per `<Link>`: quella stretta delle due, cosi' va bene per entrambi.
 */
export type Href = Parameters<ReturnType<typeof useRouter>['push']>[0];

/**
 * Da un percorso interno scritto come stringa (`/events/${slug}/live?token=…`)
 * alla forma che il router localizza (`{ pathname, params, query }`).
 *
 * Senza, il router scriverebbe l'indirizzo inglese anche in italiano e ogni
 * clic passerebbe da una redirezione — ed e' quell'indirizzo, non quello
 * giusto, che le persone copiano e condividono.
 *
 * Un percorso che la mappa non conosce e' un errore di programmazione: il
 * presidio in `localized-url.test.ts` pretende che ogni pagina sia dichiarata.
 * Il frammento (`#…`) passa nella forma a oggetto, come per `next/link`.
 */
export function percorso(path: string): Href {
  const r = riconosci(path);
  if (!r) throw new Error(`Percorso non dichiarato nella mappa degli indirizzi: ${path}`);
  return daRiconosciuto(r);
}

function daRiconosciuto(r: PercorsoRiconosciuto): Href {
  const { pathname, params, query, hash } = r;
  const conParametri = Object.keys(params).length > 0;
  const conQuery = Object.keys(query).length > 0;
  if (!conParametri && !conQuery && !hash) return pathname as Href;
  return {
    pathname,
    ...(conParametri ? { params } : {}),
    ...(conQuery ? { query } : {}),
    ...(hash ? { hash } : {}),
  } as unknown as Href;
}

/**
 * Come `percorso`, ma per indirizzi che arrivano dalla configurazione del
 * sito: un percorso che la mappa non conosce restituisce `null` invece di
 * interrompere il disegno della pagina, e chi chiama lo rende come link
 * semplice, cosi' come l'amministrazione l'ha scritto.
 */
export function percorsoSeNoto(path: string): Href | null {
  const r = riconosci(path);
  return r ? daRiconosciuto(r) : null;
}
