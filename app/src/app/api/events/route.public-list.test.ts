// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
/**
 * GET /api/events in modalità pubblica: il video di un evento esce solo se la
 * registrazione è pubblicata per tutti e dentro la finestra post-evento, come
 * nella rotta del singolo evento.
 */
import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ eventi: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: m.eventi } } }));

import { GET } from './route';

const evento = (
  id: string,
  recordingPublished: boolean,
  recordingAudience: 'PUBLIC' | 'REGISTRANTS' = 'PUBLIC',
  over: Record<string, unknown> = {}
) => ({
  id,
  slug: `evento-${id}`,
  title: { it: 'Evento' },
  description: { it: 'Descrizione' },
  startsAt: new Date('2026-10-01T10:00:00Z'),
  endsAt: new Date('2026-10-01T11:00:00Z'),
  timezone: 'Europe/Rome',
  maxParticipants: 100,
  _count: { registrations: 3 },
  qaEnabled: false,
  recordingEnabled: true,
  status: 'ENDED',
  eventType: 'SCHEDULED',
  recordingUrl: `recordings/${id}.mp4`,
  recordingPublished,
  transcriptPublished: false,
  recordingAudience,
  recordingDestination: null,
  postEventPublic: true,
  postEventPublicUntil: null,
  ...over,
});

const elenco = async () => {
  const res = await GET(
    new Request('http://x/api/events') as unknown as NextRequest,
    {
      params: Promise.resolve({}),
    } as never
  );
  const corpo = (await res.json()) as Array<{
    id: string;
    recordingUrl: string | null;
  }>;
  return corpo.map((e) => [e.id, e.recordingUrl]);
};

describe('GET /api/events, elenco pubblico', () => {
  it('il video solo per le registrazioni pubblicate', async () => {
    m.eventi.mockResolvedValueOnce([
      evento('a', true),
      evento('b', false),
      // Riservata agli iscritti: la risposta e' in cache condivisa, il video
      // passa solo dalla pagina e dal player che riconoscono l'iscritto.
      evento('c', true, 'REGISTRANTS'),
    ]);
    expect(await elenco()).toEqual([
      ['a', '/api/events/evento-a/recording'],
      ['b', null],
      ['c', null],
    ]);
  });

  it.each(['PUBLISHED', 'LIVE'])(
    'con la pagina dopo l’evento privata il video resta chiuso anche in stato %s',
    async (status) => {
      m.eventi.mockResolvedValueOnce([
        evento('a', true, 'PUBLIC', { status, recordingDestination: 'PUBLIC' }),
        evento('b', true, 'PUBLIC', {
          status,
          recordingDestination: 'PUBLIC',
          postEventPublic: false,
        }),
      ]);
      expect(await elenco()).toEqual([
        ['a', '/api/events/evento-a/recording'],
        ['b', null],
      ]);
    }
  );

  it('oltre la finestra post-evento il video resta chiuso', async () => {
    m.eventi.mockResolvedValueOnce([
      evento('a', true, 'PUBLIC', {
        status: 'LIVE',
        postEventPublicUntil: new Date('2020-01-01T00:00:00Z'),
      }),
    ]);
    expect(await elenco()).toEqual([['a', null]]);
  });
});
