// @vitest-environment node
/**
 * GET /api/events in modalità pubblica: il video di un evento esce solo se la
 * registrazione è pubblicata, come nella rotta del singolo evento.
 */
import type { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ eventi: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { event: { findMany: m.eventi } } }));

import { GET } from './route';

const evento = (id: string, recordingPublished: boolean) => ({
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
});

describe('GET /api/events, elenco pubblico', () => {
  it('il video solo per le registrazioni pubblicate', async () => {
    m.eventi.mockResolvedValueOnce([evento('a', true), evento('b', false)]);
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
    expect(corpo.map((e) => [e.id, e.recordingUrl])).toEqual([
      ['a', 'recordings/a.mp4'],
      ['b', null],
    ]);
  });
});
