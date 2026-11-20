// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * La home manda al browser gli eventi in programma: il video solo con la regola
 * delle altre superfici pubbliche (lib/recording/audience).
 */
import { isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ eventi: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: m.eventi } } }));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ homePageMode: 'EVENTS_LIST', parseTitleKicker: false }),
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
