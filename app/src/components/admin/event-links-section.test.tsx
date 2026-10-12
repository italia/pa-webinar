import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/it.json';

import EventLinksSection from './event-links-section';

const righe = [
  { chiave: 'publicPage' as const, url: 'https://esempio.it/it/eventi/x' },
  { chiave: 'guestJoin' as const, url: 'https://esempio.it/it/eventi/x/live' },
  {
    chiave: 'moderatorLink' as const,
    url: 'https://esempio.it/it/admin/eventi/1?token=t',
    riservato: true,
  },
];

function html(inBozza: boolean): string {
  return renderToString(
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      <EventLinksSection righe={righe} slug="x" inBozza={inBozza} />
    </NextIntlClientProvider>
  );
}

function conta(h: string, testo: string): number {
  return h.split(testo).length - 1;
}

describe("link dell'evento — evento in bozza", () => {
  it('pagina pubblica e invito dicono che si aprono dopo la pubblicazione', () => {
    expect(conta(html(true), messages.admin.links.notYetPublished)).toBe(2);
  });

  it('pubblicato: nessun avviso', () => {
    expect(conta(html(false), messages.admin.links.notYetPublished)).toBe(0);
  });
});
