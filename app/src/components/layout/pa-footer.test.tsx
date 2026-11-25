// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { renderToString } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '@/i18n/messages/it.json';

const impostazioni = vi.hoisted(() => ({ valore: {} as Record<string, unknown> }));
vi.mock('@/lib/settings-context', () => ({ useSettings: () => impostazioni.valore }));
vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: unknown; children?: unknown }) =>
      createElement('a', { href: String(href), ...rest }, children as never),
    percorsoSeNoto: (p: string) => p,
  };
});

import PAFooter from './pa-footer';

function html(settings: Record<string, unknown>): string {
  impostazioni.valore = { siteName: 'PA Webinar', footerLinks: [], ...settings };
  return renderToString(
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      <PAFooter />
    </NextIntlClientProvider>
  );
}

describe('piè di pagina — l’ente che porta il servizio', () => {
  it("senza ente né email di supporto la fascia non c'è", () => {
    expect(html({})).not.toContain('footer-progetto');
  });

  it('nomina l’ente sotto «Progetto di», con il logo e il collegamento al suo sito', () => {
    const h = html({
      organizationName: 'Ente di prova',
      organizationUrl: 'https://www.example.org',
      organizationLogoUrl: '/api/assets/image/logo-ente.svg',
    });
    expect(h).toContain(`>${messages.footer.projectOf}<`);
    expect(h).toContain('Ente di prova');
    expect(h).toContain('src="/api/assets/image/logo-ente.svg"');
    expect(h).toMatch(/href="https:\/\/www.example.org"[^>]*target="_blank"/);
  });

  it('senza logo resta il nome', () => {
    const h = html({ organizationName: 'Ente di prova' });
    expect(h).toContain('Ente di prova');
    expect(h).not.toContain('footer-progetto__logo');
  });

  it("l'email di supporto resta, anche senza ente", () => {
    const h = html({ supportEmail: 'supporto@example.org' });
    expect(h).toContain('mailto:supporto@example.org');
    expect(h).not.toContain(`>${messages.footer.projectOf}<`);
  });
});

describe('piè di pagina — essenziale', () => {
  it('non ripete il menu del sito ne i link al codice: solo informative, dati e trasparenza', () => {
    const h = html({
      githubUrl: 'https://github.com/esempio/progetto',
      statusPageEnabled: true,
    });
    expect(h).not.toContain('href="/events"');
    expect(h).not.toContain('href="/video-library"');
    expect(h).not.toContain('github.com/esempio/progetto');
    expect(h).not.toContain('href="/status"');
    for (const href of ['/privacy', '/legal-notice', '/privacy/my-data', '/security']) {
      expect(h).toContain(`href="${href}"`);
    }
  });

  it('niente icone davanti alle informative', () => {
    const h = html({});
    const barra = h.slice(h.indexOf('it-footer-small-prints'));
    expect(barra).not.toContain('<svg width="14"');
  });

  it('la dichiarazione di accessibilita si apre in una nuova finestra, e lo dice', () => {
    const h = html({});
    expect(h).toMatch(/href="\/accessibility"[^>]*target="_blank"/);
    expect(h).toContain(messages.footer.newWindow);
  });

  it('i link della sezione principale restano, in una riga loro', () => {
    const h = html({
      footerLinks: [{ title: 'Portale', url: 'https://example.org', section: 'main' }],
    });
    expect(h).toContain('footer-utili');
    expect(h).toContain('https://example.org');
  });

  it('non ripete dati e trasparenza se le note scelte li portano gia', () => {
    const h = html({
      footerLinks: [{ title: 'Trasparenza', url: '/security', section: 'legal' }],
    });
    expect(h.match(/href="\/security"/g)).toHaveLength(1);
    expect(h).toContain('href="/privacy/my-data"');
  });

  it('con le note legali scelte da chi amministra, dati e trasparenza restano', () => {
    const h = html({
      footerLinks: [{ title: 'Privacy', url: '/privacy', section: 'legal' }],
    });
    expect(h).toContain('href="/privacy/my-data"');
    expect(h).toContain('href="/security"');
    expect(h).not.toContain('href="/legal-notice"');
  });
});
