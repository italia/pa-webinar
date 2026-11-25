// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const pagina = vi.hoisted(() => ({ valore: '/' }));
vi.mock('@/lib/settings-context', () => ({
  useSettings: () => ({ siteName: 'PA Webinar', calendarPublic: true }),
}));
vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    usePathname: () => pagina.valore,
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
    Link: ({ href, children, ...rest }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href), ...rest }, children as never),
  };
});

import PAHeader from './pa-header';

function html(percorso: string, conStaff: boolean): string {
  pagina.valore = percorso;
  return renderToString(
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      <PAHeader staff={conStaff ? { ruolo: 'admin', nome: 'Persona Staff' } : null} />
    </NextIntlClientProvider>
  );
}

describe('intestazione — i collegamenti del sito', () => {
  it('nelle pagine pubbliche ci sono eventi, calendario e videoteca', () => {
    const h = html('/events', false);
    for (const href of ['/events', '/calendar', '/video-library']) {
      expect(h).toContain(`href="${href}"`);
    }
  });

  it('nell amministrazione, dove c e il suo menu, non ci sono', () => {
    expect(html('/admin/events', true)).not.toContain('href="/video-library"');
  });

  it('con il solo link di conduzione (niente menu dello staff) restano', () => {
    expect(html('/admin/events/[id]', false)).toContain('href="/video-library"');
  });
});
