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

describe('piè di pagina — colonna dei contatti', () => {
  it("senza sito dell'ente né email di supporto non si disegna", () => {
    expect(html({})).not.toContain(`>${messages.footer.contacts}<`);
  });

  it("con l'email di supporto c'è, con l'indirizzo", () => {
    const h = html({ supportEmail: 'supporto@example.org' });
    expect(h).toContain(`>${messages.footer.contacts}<`);
    expect(h).toContain('mailto:supporto@example.org');
  });

  it("con il solo sito dell'ente c'è, con il dominio", () => {
    const h = html({ organizationUrl: 'https://www.example.org' });
    expect(h).toContain(`>${messages.footer.contacts}<`);
    expect(h).toContain('>example.org<');
  });
});

describe('piè di pagina — trasparenza e link', () => {
  function conProps(settings: Record<string, unknown>, props: { inventarioPubblicato?: boolean }): string {
    impostazioni.valore = { siteName: 'PA Webinar', footerLinks: [], ...settings };
    return renderToString(
      <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
        <PAFooter {...props} />
      </NextIntlClientProvider>
    );
  }

  it("l'inventario dei servizi compare solo se e' pubblicato", () => {
    expect(conProps({}, { inventarioPubblicato: false })).not.toContain('href="/service-inventory"');
    expect(conProps({}, { inventarioPubblicato: true })).toContain('href="/service-inventory"');
  });

  it('la dichiarazione di accessibilita si apre in una nuova finestra, e lo dice', () => {
    const h = html({});
    expect(h).toMatch(/href="\/accessibility"[^>]*target="_blank"/);
    expect(h).toContain(messages.footer.newWindow);
  });

  it('i link della sezione principale hanno una colonna loro', () => {
    const h = html({ footerLinks: [{ title: 'Portale', url: 'https://example.org', section: 'main' }] });
    expect(h).toContain(`>${messages.footer.usefulLinks}<`);
    expect(h).toContain('https://example.org');
  });
});
