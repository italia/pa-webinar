// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * L'elenco degli eventi manda al browser l'indirizzo del video per il contrassegno
 * «registrazione»: solo con la regola delle altre superfici pubbliche
 * (lib/recording/audience).
 */
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ eventi: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: m.eventi },
    tag: { findMany: async () => [] },
  },
}));
vi.mock('@/lib/settings', () => ({
  getSettings: async () => ({ parseTitleKicker: false }),
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'it',
  getTranslations: async () => (chiave: string) => chiave,
}));
vi.mock('@/components/events/event-list', () => ({ default: () => null }));
vi.mock('@/lib/auth/staff-session', () => ({ isEventManager: vi.fn() }));
vi.mock('@/lib/auth/app-secret', () => ({ tryGetAppSecret: () => 'segreto-di-prova' }));

import EventList from '@/components/events/event-list';

import EventiPage from './page';

const evento = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `evento-${id}`,
  title: { it: 'Evento' },
  description: null,
  startsAt: new Date(Date.now() + 3_600_000),
  endsAt: new Date(Date.now() + 7_200_000),
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  _count: { registrations: 0 },
  tagLinks: [],
  status: 'PUBLISHED',
  eventType: 'SCHEDULED',
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

type Elenco = ReactElement<{
  events: Array<{ id: string; recordingUrl: string | null }>;
}>;

function elenchi(nodo: ReactNode): Elenco[] {
  return Children.toArray(nodo).flatMap((figlio) => {
    if (!isValidElement<{ children?: ReactNode }>(figlio)) return [];
    if (figlio.type === EventList) return [figlio as unknown as Elenco];
    return elenchi(figlio.props.children);
  });
}

describe('elenco degli eventi — il video', () => {
  it('con la pagina dopo l’evento privata il browser non riceve l’indirizzo', async () => {
    m.eventi.mockResolvedValueOnce([
      evento('a'),
      evento('b', { postEventPublic: false }),
    ]);
    const pagina = await EventiPage({ searchParams: Promise.resolve({}) });
    expect(
      elenchi(pagina).flatMap((l) => l.props.events.map((e) => [e.id, e.recordingUrl]))
    ).toEqual([
      ['a', 'recordings/a.mp4'],
      ['b', null],
    ]);
  });
});
