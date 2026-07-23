import type { Metadata } from 'next';

import { appBaseUrl } from '@/lib/env';

/**
 * Metadata SEO/social condivisi fra il layout e le pagine che definiscono un
 * proprio `openGraph`.
 *
 * Due trappole che hanno già morso una volta, entrambe qui evitate:
 *
 *  1. `new URL(process.env.NEXT_PUBLIC_APP_URL)` NON protetto: `getPublicEnv`
 *     restituisce il valore grezzo dell'operatore (mai vuoto — ripiega sul
 *     default localhost solo se non impostato), quindi un valore senza schema
 *     (`webinar.gov.it`) fa lanciare `new URL` DENTRO `generateMetadata`, che
 *     Next esegue per ogni pagina: l'intero sito va in 500. Stessa cura del
 *     try/catch già in `lib/auth/jwt.ts`.
 *
 *  2. `openGraph` NON si fonde fra segmenti: una pagina figlia che dichiara il
 *     proprio `openGraph` SOSTITUISCE quello del layout. Un'immagine di default
 *     messa solo nel layout non raggiunge mai le pagine evento — proprio quelle
 *     che si condividono. Per questo `openGraphImages` va incluso ANCHE nel
 *     `openGraph` di quelle pagine.
 */

/** Base assoluta per risolvere gli URL relativi dei metadata; undefined se
 *  `NEXT_PUBLIC_APP_URL` non è un URL http(s) valido (niente crash). */
export function metadataBase(): URL | undefined {
  return appBaseUrl() ?? undefined;
}

/**
 * L'array `images` per `openGraph`.
 *
 * Le dimensioni si dichiarano SOLO per l'og-image di default, che è davvero
 * 1200×630: un'immagine dell'admin o la copertina di un evento ha misure
 * ignote, e dichiararne di sbagliate fa sì che i crawler (LinkedIn, Slack)
 * riservino la cornice errata o rifiutino l'immagine. `preferred` è la scelta
 * migliore quando c'è (copertina evento, seoImage admin); altrimenti il logo.
 */
export function openGraphImages(preferred?: string | null) {
  const url = preferred?.trim();
  if (url) return [{ url }];
  return [{ url: '/images/logo/og-image.png', width: 1200, height: 630 }];
}

/** Twitter card: `summary_large_image` quando mostriamo un'immagine grande. */
export function twitterImageCard(
  title: string,
  description: string,
  preferred?: string | null,
): NonNullable<Metadata['twitter']> {
  return {
    card: 'summary_large_image',
    title,
    description,
    images: openGraphImages(preferred).map((i) => i.url),
  };
}
