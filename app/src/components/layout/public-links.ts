/**
 * I link di navigazione del sito pubblico, in un posto solo: li leggono
 * intestazione e piè di pagina, e il test di raggiungibilità
 * (components/admin/admin-nav.test.ts) controlla che ogni pagina pubblica
 * stia qui, oppure fra le pagine che si raggiungono da altro (un evento, un
 * link in un'email). Una pagina che nessun link raggiunge esiste solo per chi
 * ne conosce l'indirizzo.
 */
import type { SiteSetting } from '@prisma/client';

import type { PercorsoStatico } from '@/i18n/percorsi';

export interface LinkPubblico {
  href: PercorsoStatico;
  /** Chiave di traduzione, dalla radice dei messaggi. */
  labelKey: string;
  /** Icona dello sprite, per l'intestazione. */
  icon?: string;
  /** Il link compare solo se questa impostazione e' accesa. */
  soloSe?: keyof Pick<SiteSetting, 'calendarPublic' | 'statusPageEnabled'>;
}

/** Intestazione, a destra: su ogni pagina. */
export const LINK_INTESTAZIONE: readonly LinkPubblico[] = [
  { href: '/calendar', labelKey: 'nav.calendar', icon: 'it-calendar', soloSe: 'calendarPublic' },
  { href: '/video-library', labelKey: 'nav.videoLibrary', icon: 'it-video' },
];

/** Piè di pagina, colonna degli eventi: quello che serve a chi partecipa. */
export const LINK_PIEDE_EVENTI: readonly LinkPubblico[] = [
  { href: '/events', labelKey: 'nav.allEvents' },
  { href: '/calendar', labelKey: 'nav.calendar', soloSe: 'calendarPublic' },
  { href: '/video-library', labelKey: 'nav.videoLibrary' },
  { href: '/privacy/my-data', labelKey: 'gdpr.export.title' },
];

/** Il link va mostrato con queste impostazioni? */
export function linkVisibile(link: LinkPubblico, settings: SiteSetting): boolean {
  return !link.soloSe || settings[link.soloSe] === true;
}
