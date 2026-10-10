/**
 * L'anteprima di un link a un evento (OpenGraph e Twitter), la stessa per
 * tutte le pagine dell'evento che si condividono: la pagina pubblica, il
 * link per entrare in sala e quello dell'iscrizione. Chi riceve il link in
 * chat vede titolo, descrizione e scheda dell'evento qualunque sia la
 * pagina, non l'anteprima generica del sito.
 *
 * Next non fonde l'`openGraph` fra i segmenti (vedi lib/seo): ogni pagina lo
 * dichiara intero, ed e' per questo che si costruisce qui una volta sola.
 */
import { createHash } from 'node:crypto';

import { defaultLocale, locales } from '@/i18n/config';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { getPublicEnv } from '@/lib/env';
import { accorcia } from '@/lib/og-card';
import { openGraphImages, twitterImageCard } from '@/lib/seo';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';
import { markdownToPlainText } from '@/lib/utils/markdown-text';

import { entiEPersonePubblici } from './public-people';

/** Il paese di una lingua quando quello «probabile» non e' europeo. */
const PAESE: Record<string, string> = { en: 'GB' };

/** La lingua dell'anteprima nella forma che chiede OpenGraph (lingua_PAESE),
 *  ricavata dalle lingue dell'interfaccia: una lingua aggiunta ha la sua. */
export function ogLocale(locale: string): string {
  const lingua = (locales as readonly string[]).includes(locale) ? locale : defaultLocale;
  let paese = PAESE[lingua];
  if (!paese) {
    try {
      paese = new Intl.Locale(lingua).maximize().region;
    } catch {
      paese = undefined;
    }
  }
  return paese ? `${lingua}_${paese}` : lingua;
}

/**
 * Un'impronta di enti e persone pubblicati: la scheda li stampa, ma
 * cambiarli non tocca l'evento. Entra nell'indirizzo dell'immagine, cosi' i
 * servizi di anteprima la riprendono quando si aggiunge un relatore o se ne
 * toglie uno (anche per una cancellazione dei dati personali).
 */
export function firmaPersone(event: Parameters<typeof entiEPersonePubblici>[0]): string {
  const { enti, persone } = entiEPersonePubblici(event, tryDecryptPII);
  return createHash('sha256')
    .update(JSON.stringify([enti.map((e) => e.name), persone.map((p) => [p.role, p.name])]))
    .digest('hex')
    .slice(0, 10);
}

/** Oltre, i servizi che mostrano le anteprime tagliano da soli, a meta' parola. */
const MAX_DESCRIZIONE = 160;

export interface EventoAnteprima {
  slug: string;
  title: unknown;
  description: unknown;
  coverImageUrl: string | null;
  imageUrl: string | null;
  updatedAt: Date;
  /** `firmaPersone` dell'evento: senza, l'immagine segue solo l'evento. */
  firmaPersone?: string;
}

export interface ImpostazioniAnteprima {
  ogCardEnabled: boolean;
  siteName: string | null;
}

/**
 * Titolo, descrizione e anteprima di un evento per la pagina `percorso`
 * (interno, in inglese: `/events/<slug>/live`). La descrizione e' scritta in
 * Markdown: nell'anteprima esce come testo, senza asterischi e indirizzi.
 */
export function anteprimaEvento(
  event: EventoAnteprima,
  settings: ImpostazioniAnteprima,
  locale: string,
  percorso: string,
) {
  const title = getLocalized(event.title as LocalizedField, locale);
  const description = accorcia(
    markdownToPlainText(getLocalized(event.description as LocalizedField, locale)),
    MAX_DESCRIZIONE,
  );
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const immagine = immagineAnteprima(event, settings, locale);
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: localizedUrl(baseUrl, percorso, locale),
      type: 'website' as const,
      locale: ogLocale(locale),
      siteName: settings.siteName || 'PA Webinar',
      images: immagine.scheda
        ? [{ url: immagine.url, width: 1200, height: 630 }]
        : openGraphImages(immagine.url),
    },
    twitter: twitterImageCard(title, description, immagine.url),
  };
}

/**
 * L'immagine dell'anteprima: la scheda composta dal server quando
 * l'amministrazione la vuole (titolo, data e relatori DENTRO l'immagine, che
 * e' l'unica cosa che molte applicazioni mostrano di un link), altrimenti la
 * copertina dell'evento (null: il logo). La scheda ha un indirizzo assoluto
 * con l'ultima modifica dell'evento e l'impronta delle persone: i servizi di
 * anteprima tengono l'immagine in cache per indirizzo, anche per giorni, e un
 * titolo corretto la mattina dell'evento non cambierebbe nulla. Lo slug si
 * codifica: segue una query.
 */
export function immagineAnteprima(
  event: EventoAnteprima,
  settings: ImpostazioniAnteprima,
  locale: string,
): { url: string; scheda: true } | { url: string | null; scheda: false } {
  if (!settings.ogCardEnabled) {
    return { url: event.coverImageUrl ?? event.imageUrl, scheda: false };
  }
  const versione = event.firmaPersone
    ? `${event.updatedAt.getTime()}-${event.firmaPersone}`
    : `${event.updatedAt.getTime()}`;
  return {
    url:
      `${getPublicEnv('NEXT_PUBLIC_APP_URL')}/api/og/event/${encodeURIComponent(event.slug)}` +
      `?locale=${locale}&v=${versione}`,
    scheda: true,
  };
}

/** Le versioni della pagina nelle lingue attive del sito (hreflang). */
export function versioniLinguistiche(percorso: string, lingueAttive: unknown): Record<string, string> {
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const attive = Array.isArray(lingueAttive)
    ? lingueAttive.filter(
        (l): l is string => typeof l === 'string' && (locales as readonly string[]).includes(l),
      )
    : [];
  const lingue = attive.length > 0 ? attive : ['it', 'en'];
  return Object.fromEntries(lingue.map((l) => [l, localizedUrl(baseUrl, percorso, l)]));
}
