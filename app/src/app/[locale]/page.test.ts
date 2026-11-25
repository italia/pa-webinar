// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * La home manda al browser gli eventi in programma: il video solo con la regola
 * delle altre superfici pubbliche (lib/recording/audience).
 */
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  eventi: vi.fn(),
  impostazioni: {} as Record<string, unknown>,
}));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: m.eventi } } }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({
    homePageMode: 'EVENTS_LIST',
    parseTitleKicker: false,
    ...m.impostazioni,
  }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getTranslations: async () => (chiave: string) => chiave,
}));
vi.mock('@/i18n/navigation', () => ({ Link: () => null }));
vi.mock('@/components/events/event-list', () => ({ default: () => null }));
vi.mock('@/components/home/landing-istituzionale', () => ({ default: () => null }));
vi.mock('@/components/home/landing-semplice', () => ({ default: () => null }));
vi.mock('@/components/home/nessun-evento', () => ({ default: () => null }));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: vi.fn() }));
vi.mock('@/lib/auth/app-secret', () => ({ tryGetAppSecret: () => 'segreto-di-prova' }));

import HomePage from './page';

const evento = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `evento-${id}`,
  title: { it: 'Evento' },
  description: null,
  startsAt: new Date('2026-12-01T10:00:00Z'),
  endsAt: new Date('2026-12-01T11:00:00Z'),
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  _count: { registrations: 0 },
  status: 'PUBLISHED',
  recordingUrl: `recordings/${id}.mp4`,
  recordingPublished: true,
  transcriptPublished: false,
  recordingAudience: 'PUBLIC',
  recordingDestination: 'PUBLIC',
  postEventPublic: true,
  postEventPublicUntil: null,
  speakersInfo: null,
  organizerName: null,
  imageUrl: null,
  parseTitleKicker: null,
  ...over,
});

describe('home — il video degli eventi in programma', () => {
  it('con la pagina dopo l’evento privata il browser non riceve l’indirizzo', async () => {
    m.eventi.mockResolvedValueOnce([
      evento('a'),
      evento('b', { postEventPublic: false }),
    ]);
    const pagina = await HomePage();
    expect(isValidElement(pagina)).toBe(true);
    const { upcoming } = (
      pagina as {
        props: { upcoming: Array<{ id: string; recordingUrl: string | null }> };
      }
    ).props;
    expect(upcoming.map((e) => [e.id, e.recordingUrl])).toEqual([
      ['a', '/api/events/evento-a/recording'],
      ['b', null],
    ]);
  });
});

/** I testi di un albero di elementi, cercati fra le props. */
function testi(nodo: unknown, out: string[] = []): string[] {
  if (typeof nodo === 'string') out.push(nodo);
  else if (Array.isArray(nodo)) nodo.forEach((n) => testi(n, out));
  else if (isValidElement(nodo)) {
    for (const v of Object.values(nodo.props as Record<string, unknown>)) testi(v, out);
  } else if (nodo && typeof nodo === 'object') {
    for (const v of Object.values(nodo)) testi(v, out);
  }
  return out;
}

describe('home — le lingue del sito', () => {
  async function badge(availableLocales: unknown): Promise<string[]> {
    m.impostazioni = { homePageMode: 'LANDING', availableLocales };
    m.eventi.mockResolvedValueOnce([]);
    const pagina = await HomePage();
    if (!isValidElement(pagina) || typeof pagina.type !== 'function') {
      throw new Error('la home predefinita non e\' un componente');
    }
    const albero = await (pagina.type as (p: unknown) => Promise<unknown>)(pagina.props);
    return testi(albero).filter((t) => t.startsWith('hero.badges.languages'));
  }

  it('tutte e 24 attive: le lingue dell’Unione europea', async () => {
    const { locales } = await import('@/i18n/config');
    expect(await badge([...locales])).toEqual(['hero.badges.languagesAll']);
  });

  it('solo alcune (di default italiano e inglese): «in più lingue», senza numeri', async () => {
    expect(await badge(undefined)).toEqual(['hero.badges.languagesSome']);
    expect(await badge(['it', 'en', 'fr'])).toEqual(['hero.badges.languagesSome']);
  });

  it('una lingua sola, o codici che il sito non ha, nessun badge', async () => {
    expect(await badge(['it'])).toEqual([]);
    // Un elenco vuoto, come per il selettore della lingua: nessuna scelta.
    expect(await badge([])).toEqual([]);
    expect(await badge(['it', 'xx', 'it'])).toEqual([]);
  });
});
