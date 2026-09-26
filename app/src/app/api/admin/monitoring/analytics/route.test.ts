// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { admin, groupBy, callSessions, eventsFindMany } = vi.hoisted(() => ({
  admin: vi.fn(async () => true),
  groupBy: vi.fn(async (): Promise<unknown[]> => []),
  callSessions: vi.fn(async (): Promise<unknown[]> => []),
  eventsFindMany: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('@/lib/auth/admin-session', () => ({ isAdminAuthenticated: admin }));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findMany: eventsFindMany, groupBy },
    registration: { findMany: vi.fn(async () => []) },
    callSession: { findMany: callSessions },
  },
}));

import { GET } from './route';

async function chiedi(query = '') {
  const res = await GET(
    new Request(`http://localhost:3000/api/admin/monitoring/analytics${query}`) as never,
    { params: Promise.resolve({}) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    scaleToZero: { liveEvents: number; provisioningEvents: number; idleEvents: number };
    recentCalls: Array<{ eventTitle: string }>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  groupBy.mockResolvedValue([]);
  callSessions.mockResolvedValue([]);
  eventsFindMany.mockResolvedValue([]);
});

describe('GET /api/admin/monitoring/analytics', () => {
  it('le dirette contano anche oltre l’orario di fine, gli altri stati no', async () => {
    groupBy.mockImplementation((async (args: { where: unknown }) => {
      const where = JSON.stringify(args.where);
      if (where.includes('{"status":"LIVE"}')) {
        return [
          { status: 'LIVE', _count: { id: 4 } },
          { status: 'PROVISIONING', _count: { id: 1 } },
        ];
      }
      return [];
    }) as never);

    const body = await chiedi();

    expect(body.scaleToZero).toEqual({ liveEvents: 4, provisioningEvents: 1, idleEvents: 0 });
    const conteggio = (groupBy.mock.calls as unknown as Array<[{ where: { OR?: unknown[] } }]>)
      .map((c) => c[0].where)
      .find((w) => Array.isArray(w.OR));
    expect(JSON.stringify(conteggio)).toContain('{"status":"LIVE"}');
    expect(JSON.stringify(conteggio)).toMatch(/"status":"IDLE","endsAt"/);
  });

  it('i titoli delle chiamate nella lingua della pagina', async () => {
    callSessions.mockResolvedValue([
      {
        id: 'cs1',
        eventId: 'e1',
        jitsiRoomName: 'stanza',
        startedAt: new Date('2026-09-01T10:00:00Z'),
        endedAt: null,
        duration: null,
        peakParticipants: 2,
        recordingUrl: null,
        recordingFileSize: null,
        telemetry: {},
        event: { slug: 'evento', title: { it: 'Titolo', en: 'Title' } },
      },
    ]);

    const body = await chiedi('?range=24h&locale=en');

    expect(body.recentCalls[0]?.eventTitle).toBe('Title');
  });

  it('senza sessione di amministrazione: 401', async () => {
    admin.mockResolvedValueOnce(false);
    const res = await GET(
      new Request('http://localhost:3000/api/admin/monitoring/analytics') as never,
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(401);
  });
});
