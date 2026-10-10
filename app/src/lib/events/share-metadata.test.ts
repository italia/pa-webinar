import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  getPublicEnv: () => 'https://webinar.example.org',
}));

vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));

import { anteprimaEvento, firmaPersone, immagineAnteprima, ogLocale, versioniLinguistiche } from './share-metadata';

const evento = {
  slug: 'riuso-del-software',
  title: { it: 'Il riuso del software', en: 'Software reuse' },
  description: {
    it: '## Programma\n\nCon **Relatore 1**: [le linee guida](https://example.org/lg) e domande dal pubblico.',
  },
  coverImageUrl: '/api/assets/assets/cover/2026/10/copertina.png',
  imageUrl: null,
  updatedAt: new Date('2026-10-10T10:00:00.000Z'),
};

describe('anteprimaEvento', () => {
  it('la descrizione esce come testo, senza la sintassi Markdown', () => {
    const a = anteprimaEvento(evento, { ogCardEnabled: true, siteName: 'PA Webinar' }, 'it', '/events/riuso-del-software');
    expect(a.description).toBe(
      'Programma. Con Relatore 1: le linee guida e domande dal pubblico.',
    );
    expect(a.openGraph.description).toBe(a.description);
    expect(a.twitter.description).toBe(a.description);
  });

  it('una descrizione lunga si taglia su una parola, entro 160 caratteri', () => {
    const lunga = { it: 'parola '.repeat(60) };
    const a = anteprimaEvento({ ...evento, description: lunga }, { ogCardEnabled: false, siteName: null }, 'it', '/events/x');
    expect(a.description.length).toBeLessThanOrEqual(161);
    expect(a.description.endsWith('parola…')).toBe(true);
  });

  it('il link e’ quello della pagina condivisa, nella sua lingua', () => {
    const a = anteprimaEvento(evento, { ogCardEnabled: true, siteName: null }, 'it', '/events/riuso-del-software/live');
    expect(a.openGraph.url).toBe('https://webinar.example.org/it/eventi/riuso-del-software/live');
    expect(a.openGraph.locale).toBe('it_IT');
    expect(a.openGraph.siteName).toBe('PA Webinar');
  });

  it('con la scheda accesa l’immagine e’ la scheda, con lingua e versione', () => {
    const a = anteprimaEvento(evento, { ogCardEnabled: true, siteName: null }, 'en', '/events/riuso-del-software');
    expect(a.openGraph.images[0]).toEqual({
      url: 'https://webinar.example.org/api/og/event/riuso-del-software?locale=en&v=1791626400000',
      width: 1200,
      height: 630,
    });
    expect(a.title).toBe('Software reuse');
  });

  it('con la scheda spenta l’immagine e’ la copertina', () => {
    const a = anteprimaEvento(evento, { ogCardEnabled: false, siteName: null }, 'it', '/events/riuso-del-software');
    expect(a.openGraph.images[0]?.url).toBe(evento.coverImageUrl);
  });
});

describe('ogLocale e versioniLinguistiche', () => {
  it('ogni lingua ha la sua forma OpenGraph', () => {
    expect(ogLocale('de')).toBe('de_DE');
    expect(ogLocale('sl')).toBe('sl_SI');
    expect(ogLocale('en')).toBe('en_GB');
    expect(ogLocale('xx')).toBe('it_IT');
  });

  it('le versioni sono quelle delle lingue attive del sito', () => {
    expect(versioniLinguistiche('/events/riuso', ['it', 'de', 'zz'])).toEqual({
      it: 'https://webinar.example.org/it/eventi/riuso',
      de: 'https://webinar.example.org/de/events/riuso',
    });
    expect(Object.keys(versioniLinguistiche('/events/riuso', null))).toEqual(['it', 'en']);
  });
});

describe('immagine e persone', () => {
  const conPersone = (nomi: string[]) => ({
    organizers: [{ name: 'Ente A', logoUrl: null, websiteUrl: null }],
    additionalMods: nomi.map((name) => ({
      name,
      role: 'SPEAKER' as const,
      organizer: false,
      organization: null,
      organizationLogoUrl: null,
    })),
    moderatorName: null,
    moderatorPublicListed: false,
    moderatorOrganization: null,
    moderatorOrganizationLogoUrl: null,
  });

  it('togliere un relatore cambia l’indirizzo della scheda', () => {
    const prima = firmaPersone(conPersone(['Relatore 1', 'Relatore 2']));
    const dopo = firmaPersone(conPersone(['Relatore 1']));
    expect(prima).not.toBe(dopo);
    const settings = { ogCardEnabled: true, siteName: null };
    const a = immagineAnteprima({ ...evento, firmaPersone: prima }, settings, 'it');
    const b = immagineAnteprima({ ...evento, firmaPersone: dopo }, settings, 'it');
    expect(a.url).not.toBe(b.url);
    expect(a.url).toContain(`v=${evento.updatedAt.getTime()}-${prima}`);
  });

  it('le stesse persone danno lo stesso indirizzo', () => {
    expect(firmaPersone(conPersone(['Relatore 1']))).toBe(firmaPersone(conPersone(['Relatore 1'])));
  });
});
