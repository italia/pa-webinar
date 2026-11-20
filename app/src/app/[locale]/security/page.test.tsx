// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * La pagina «Sicurezza e trasparenza» non fa caricare al browser risorse di
 * terze parti: un badge remoto contatterebbe un altro server a ogni visita e
 * la CSP dell'applicazione (img-src) lo blocca comunque, lasciando
 * un'immagine rotta. Il punteggio resta raggiungibile dal link testuale.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({
    githubUrl: 'https://github.com/esempio/progetto',
    statusPageEnabled: true,
  })),
}));
vi.mock('@/lib/service-inventory-url', () => ({ serviceInventoryUrl: () => '/inventario.json' }));
vi.mock('@/i18n/navigation', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ href, children }: { href: string; children?: unknown }) =>
      createElement('a', { href }, children as never),
  };
});

import SecurityPage from './page';

describe('SecurityPage', () => {
  it('non incorpora immagini remote e tiene il link testuale al punteggio', async () => {
    const html = renderToStaticMarkup(await SecurityPage());
    expect(html).not.toContain('<img');
    expect(html).not.toContain('api.scorecard.dev');
    expect(html).toContain(
      'href="https://scorecard.dev/viewer/?uri=github.com/esempio/progetto"',
    );
    expect(html).toContain('links.scorecard');
  });

  it('porta all inventario e allo stato del servizio', async () => {
    const html = renderToStaticMarkup(await SecurityPage());
    expect(html).toContain('href="/service-inventory"');
    expect(html).toContain('href="/status"');
  });
});
