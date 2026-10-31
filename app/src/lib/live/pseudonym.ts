import { createHash } from 'node:crypto';

import { getTranslations } from 'next-intl/server';

import { defaultLocale, locales } from '@/i18n/config';
import { getSettings } from '@/lib/settings';

/**
 * Lo pseudonimo di chi partecipa a un evento con il pubblico anonimo
 * (Event.audienceAnonymous): «Partecipante-7K2QXM». Una parola sola, perche'
 * le menzioni in chat («@…») si riconoscono dalla prima parola del nome; sei
 * caratteri, perche' in un evento di migliaia di persone due codici uguali
 * siano improbabili.
 *
 * Il codice deriva dall'evento e dal posto (l'iscrizione, o per l'ospite la
 * chiave che la chat gli da'), non dalla persona: e' lo stesso in video, in
 * chat e nelle domande, e lo stesso a ogni rientro, ma da un evento all'altro
 * cambia. Per l'ospite il posto dipende dall'indirizzo di rete, come in chat:
 * cambiando rete cambia anche lo pseudonimo.
 * Non si puo' risalire al nome: e' un'impronta, non una cifratura.
 *
 * La parola («Partecipante») e' nella lingua predefinita del sito: lo
 * pseudonimo lo vedono tutti, ciascuno nella propria lingua dell'interfaccia,
 * ma il nome in video e' uno solo.
 */
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function codicePseudonimo(eventId: string, posto: string): string {
  const h = createHash('sha256').update(`pa-pseudonimo:${eventId}:${posto}`).digest();
  let codice = '';
  for (let i = 0; i < 6; i++) codice += ALFABETO[h[i]! % ALFABETO.length];
  return codice;
}

export async function pseudonimo(eventId: string, posto: string): Promise<string> {
  const scelta = (await getSettings()).defaultLocale;
  const lingua = (locales as readonly string[]).includes(scelta ?? '')
    ? scelta!
    : defaultLocale;
  // Come le altre rotte: con le traduzioni personalizzate dall'amministrazione.
  const t = await getTranslations({ locale: lingua, namespace: 'live' });
  return t('pseudonym', { code: codicePseudonimo(eventId, posto) });
}
