import { appBaseUrl, getPublicEnv } from '@/lib/env';

/**
 * L'indirizzo pubblico del portale, senza barra finale, per i link nelle
 * email.
 *
 * Si legge a RUNTIME (`getPublicEnv`), mai con `process.env.NEXT_PUBLIC_*`
 * puntato: quello lo sostituisce webpack al build, e l'immagine pubblicata
 * porta il default del Dockerfile (`http://localhost:3000`). Un link a
 * localhost dentro un'email non si puo' piu' correggere dopo l'invio.
 *
 * `appBaseUrl()` normalizza un valore valido; su un valore senza schema resta
 * il valore configurato, cosi' chi legge l'email vede almeno l'indirizzo che
 * l'istanza ha dichiarato.
 */
export function emailBaseUrl(): string {
  const url = appBaseUrl();
  return (url ? url.href : getPublicEnv('NEXT_PUBLIC_APP_URL')).replace(/\/+$/, '');
}
