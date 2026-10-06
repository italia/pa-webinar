/**
 * La scaletta: aggiungere un argomento o un elenco, riordinare, e la lettura
 * leggera per la barra della sala.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(async () => 1),
    eventAgendaItem: {
      aggregate: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventAgendaItem: { findMany: vi.fn() },
    agendaItemReaction: { groupBy: vi.fn(), findMany: vi.fn() },
    registration: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  verifyModeratorToken: vi.fn(async (_slug: string, token: string) =>
    token === 'MOD' ? { id: EVENT_ID } : null,
  ),
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { deleteCacheByPrefix } from '@/lib/cache';

import { GET, POST, PUT } from './route';

const ctx = () => ({ params: Promise.resolve({ param: 'evento' }) });
const req = (method: string, body?: unknown, token = 'MOD', query = '') =>
  new Request(`https://webinar.gov.it/api/events/evento/agenda${query}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedItems = prisma.eventAgendaItem.findMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  deleteCacheByPrefix('agenda-lite:');
  tx.eventAgendaItem.aggregate.mockResolvedValue({ _max: { sortOrder: 4 }, _count: { _all: 4 } });
  tx.eventAgendaItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: 'nuovo',
    ...args.data,
  }));
  tx.eventAgendaItem.findMany.mockResolvedValue([{ id: A }, { id: B }, { id: C }]);
  tx.eventAgendaItem.update.mockResolvedValue({});
  mockedEvent.mockResolvedValue({ id: EVENT_ID, agendaEnabled: true });
});

describe('POST /api/events/[slug]/agenda', () => {
  it('un argomento con la durata prevista: in coda alla scaletta', async () => {
    const res = await POST(req('POST', { label: '  Apertura  ', plannedMinutes: 10 }), ctx());
    expect(res.status).toBe(201);
    const creato = (await res.json()) as Record<string, unknown>;
    expect(creato).toMatchObject({ label: 'Apertura', plannedMinutes: 10, sortOrder: 5 });
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'agenda');
  });

  it('un elenco incollato: un argomento per riga, nell’ordine dato', async () => {
    const res = await POST(req('POST', { labels: ['Apertura', 'Domande', 'Chiusura'] }), ctx());
    expect(res.status).toBe(201);
    const { items } = (await res.json()) as { items: { label: string; sortOrder: number }[] };
    expect(items.map((i) => [i.label, i.sortOrder])).toEqual([
      ['Apertura', 5],
      ['Domande', 6],
      ['Chiusura', 7],
    ]);
  });

  it('un titolo vuoto non passa, neanche nell’elenco', async () => {
    expect((await POST(req('POST', { label: '   ' }), ctx())).status).toBeGreaterThanOrEqual(400);
    expect((await POST(req('POST', { labels: ['Apertura', ' '] }), ctx())).status).toBeGreaterThanOrEqual(400);
    expect(tx.eventAgendaItem.create).not.toHaveBeenCalled();
  });

  it('oltre il tetto di argomenti non si aggiunge: il riordino deve poterli elencare tutti', async () => {
    tx.eventAgendaItem.aggregate.mockResolvedValue({ _max: { sortOrder: 199 }, _count: { _all: 199 } });
    const res = await POST(req('POST', { labels: ['Uno', 'Due'] }), ctx());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(tx.eventAgendaItem.create).not.toHaveBeenCalled();
  });

  it('una durata fuori misura non passa', async () => {
    const res = await POST(req('POST', { label: 'Apertura', plannedMinutes: 0 }), ctx());
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('senza token di moderazione: niente', async () => {
    const res = await POST(req('POST', { label: 'Apertura' }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/events/[slug]/agenda (riordino)', () => {
  it('riscrive le posizioni nell’ordine dato', async () => {
    const res = await PUT(req('PUT', { order: [C, A, B] }), ctx());
    expect(res.status).toBe(204);
    expect(tx.eventAgendaItem.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: C }, data: { sortOrder: 1 } },
      { where: { id: A }, data: { sortOrder: 2 } },
      { where: { id: B }, data: { sortOrder: 3 } },
    ]);
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'agenda');
  });

  it('un ordine vecchio (manca un argomento) si rifiuta, senza toccare niente', async () => {
    const res = await PUT(req('PUT', { order: [C, A] }), ctx());
    expect(res.status).toBe(409);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
  });

  it('un argomento ripetuto o di un altro evento si rifiuta', async () => {
    expect((await PUT(req('PUT', { order: [A, A, B] }), ctx())).status).toBe(409);
    const estraneo = '44444444-4444-4444-8444-444444444444';
    expect((await PUT(req('PUT', { order: [A, B, estraneo] }), ctx())).status).toBe(409);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
  });

  it('senza token di moderazione: niente', async () => {
    const res = await PUT(req('PUT', { order: [A, B, C] }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
  });
});

describe('GET ?lite=1 (barra della sala)', () => {
  it('solo titoli, stati e tempi: niente reazioni, niente identità', async () => {
    mockedItems.mockResolvedValue([
      {
        id: A,
        label: 'Apertura',
        status: 'CURRENT',
        startedAt: new Date('2026-10-08T10:00:00Z'),
        completedAt: null,
        plannedMinutes: 10,
      },
    ]);
    const res = await GET(req('GET', undefined, '', '?lite=1'), ctx());
    expect(await res.json()).toEqual({
      agendaEnabled: true,
      items: [
        {
          id: A,
          label: 'Apertura',
          status: 'CURRENT',
          startedAt: '2026-10-08T10:00:00.000Z',
          completedAt: null,
          plannedMinutes: 10,
        },
      ],
    });
    expect(prisma.agendaItemReaction.groupBy).not.toHaveBeenCalled();
    expect(prisma.registration.findUnique).not.toHaveBeenCalled();
  });

  it('resta in caldo, e una modifica la rinfresca', async () => {
    mockedItems.mockResolvedValue([]);
    await GET(req('GET', undefined, '', '?lite=1'), ctx());
    await GET(req('GET', undefined, '', '?lite=1'), ctx());
    expect(mockedItems).toHaveBeenCalledTimes(1);

    await POST(req('POST', { label: 'Nuovo' }), ctx());
    await GET(req('GET', undefined, '', '?lite=1'), ctx());
    expect(mockedItems).toHaveBeenCalledTimes(2);
  });
});
