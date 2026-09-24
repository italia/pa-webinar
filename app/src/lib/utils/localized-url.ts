import { traduci } from '@/i18n/percorsi';

/**
 * Indirizzi pubblici con i segmenti nella lingua di chi li riceve.
 *
 * Servono dove non passa il router: email, calendario, anteprime condivise,
 * link da copiare. Si derivano dalla stessa mappa che usa il router
 * (`routing.pathnames`), non da una tabella a parte: una tabella parallela
 * resta indietro, e un indirizzo che il router non riconosce e' un 404 dentro
 * un'email che nessuno puo' piu' correggere.
 *
 * Si parte sempre dal percorso interno, in inglese (`/events/<slug>/live`).
 * Query e frammento passano intatti.
 */
export function localizedPath(path: string, locale: string): string {
  return `/${locale}${traduci(path, locale)}`;
}

/** Indirizzo completo, per email, calendario e condivisioni. */
export function localizedUrl(baseUrl: string, path: string, locale: string): string {
  return `${baseUrl}${localizedPath(path, locale)}`;
}
