/**
 * L'agenda: aggiungere un argomento o un elenco, riordinare, salvare il
 * programma preparato prima dell'evento, e le letture (la leggera per la
 * barra della sala) che non dicono chi interviene.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(async () => 1),
    eventAgendaItem: {
      aggregate: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    eventModerator: { findMany: vi.fn() },
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
  tx.eventAgendaItem.deleteMany.mockResolvedValue({ count: 0 });
  tx.eventModerator.findMany.mockResolvedValue([]);
  mockedEvent.mockResolvedValue({ id: EVENT_ID, agendaEnabled: true });
});

describe('POST /api/events/[slug]/agenda', () => {
  it('un argomento con la durata prevista: in coda all’agenda', async () => {
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

describe('PUT /api/events/[slug]/agenda (programma)', () => {
  const RELATRICE = '88888888-8888-4888-8888-888888888888';
  const intatto = (id: string) => ({ id, status: 'PENDING', _count: { reactions: 0 } });

  beforeEach(() => {
    tx.eventAgendaItem.findMany.mockResolvedValue([intatto(A), intatto(B)]);
    tx.eventAgendaItem.update.mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => ({ id: args.where.id, ...args.data }),
    );
    tx.eventAgendaItem.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
      id: C,
      ...args.data,
    }));
    tx.eventModerator.findMany.mockResolvedValue([{ id: RELATRICE }]);
  });

  it('aggiorna, crea e toglie in una richiesta, con le posizioni nuove e chi interviene', async () => {
    const res = await PUT(
      req('PUT', {
        base: [A, B],
        plan: [
          { label: '  Saluti  ', plannedMinutes: 10, speakerPrimary: true },
          { id: A, label: 'Intervento', plannedMinutes: 30, speakerGrantId: RELATRICE },
        ],
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    // Il turno della transazione: prima il blocco dell'evento.
    expect(tx.$executeRaw).toHaveBeenCalled();
    // B non c'è più nel programma: si toglie.
    expect(tx.eventAgendaItem.deleteMany).toHaveBeenCalledWith({ where: { eventId: EVENT_ID, id: { in: [B] } } });
    expect(tx.eventAgendaItem.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        eventId: EVENT_ID,
        label: 'Saluti',
        plannedMinutes: 10,
        speakerGrantId: null,
        speakerPrimary: true,
        sortOrder: 1,
      },
    });
    expect(tx.eventAgendaItem.update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: A },
      data: { label: 'Intervento', plannedMinutes: 30, speakerGrantId: RELATRICE, speakerPrimary: false, sortOrder: 2 },
    });
    // La persona si cerca fra quelle valide di QUESTO evento.
    expect(tx.eventModerator.findMany).toHaveBeenCalledWith({
      where: { id: { in: [RELATRICE] }, eventId: EVENT_ID, revokedAt: null },
      select: { id: true },
    });
    const { items } = (await res.json()) as { items: { id: string; sortOrder: number }[] };
    expect(items.map((i) => [i.id, i.sortOrder])).toEqual([
      [C, 1],
      [A, 2],
    ]);
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'agenda');
  });

  it('un programma vuoto su un’agenda vuota non scrive niente', async () => {
    tx.eventAgendaItem.findMany.mockResolvedValue([]);
    const res = await PUT(req('PUT', { base: [], plan: [] }), ctx());
    expect(res.status).toBe(200);
    expect(tx.eventAgendaItem.create).not.toHaveBeenCalled();
    expect(tx.eventAgendaItem.deleteMany).not.toHaveBeenCalled();
  });

  it('se l’agenda è cambiata nel frattempo si rifiuta, senza toccare niente', async () => {
    const res = await PUT(req('PUT', { base: [A], plan: [{ id: A, label: 'Uno' }] }), ctx());
    expect(res.status).toBe(409);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
    expect(tx.eventAgendaItem.deleteMany).not.toHaveBeenCalled();
  });

  it('un’agenda già usata in sala non si riscrive: un argomento avviato o con reazioni', async () => {
    tx.eventAgendaItem.findMany.mockResolvedValue([intatto(A), { id: B, status: 'DONE', _count: { reactions: 0 } }]);
    expect((await PUT(req('PUT', { base: [A, B], plan: [] }), ctx())).status).toBe(409);
    tx.eventAgendaItem.findMany.mockResolvedValue([intatto(A), { id: B, status: 'PENDING', _count: { reactions: 2 } }]);
    expect((await PUT(req('PUT', { base: [A, B], plan: [] }), ctx())).status).toBe(409);
    expect(tx.eventAgendaItem.deleteMany).not.toHaveBeenCalled();
  });

  it('chi interviene dev’essere una persona valida di questo evento', async () => {
    tx.eventModerator.findMany.mockResolvedValue([]);
    const res = await PUT(
      req('PUT', { base: [A, B], plan: [{ id: A, label: 'Uno', speakerGrantId: RELATRICE }] }),
      ctx(),
    );
    expect(res.status).toBe(422);
    const corpo = (await res.json()) as { details: { path: unknown[] }[] };
    expect(corpo.details[0]?.path).toEqual(['plan', 0, 'speakerGrantId']);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
  });

  it('una persona e l’organizzatore principale insieme non si accettano', async () => {
    const res = await PUT(
      req('PUT', {
        base: [A, B],
        plan: [{ id: A, label: 'Uno', speakerGrantId: RELATRICE, speakerPrimary: true }],
      }),
      ctx(),
    );
    expect(res.status).toBe(422);
  });

  it('un argomento che non è di questa agenda, o ripetuto, non si aggiorna', async () => {
    const estraneo = '44444444-4444-4444-8444-444444444444';
    expect(
      (await PUT(req('PUT', { base: [A, B], plan: [{ id: estraneo, label: 'X' }] }), ctx())).status,
    ).toBe(422);
    expect(
      (
        await PUT(
          req('PUT', { base: [A, B], plan: [{ id: A, label: 'X' }, { id: A, label: 'Y' }] }),
          ctx(),
        )
      ).status,
    ).toBe(422);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
  });

  it('titolo vuoto o durata fuori misura non passano', async () => {
    expect((await PUT(req('PUT', { base: [], plan: [{ label: ' ' }] }), ctx())).status).toBe(422);
    expect(
      (await PUT(req('PUT', { base: [], plan: [{ label: 'Uno', plannedMinutes: 601 }] }), ctx())).status,
    ).toBe(422);
  });

  it('senza token di moderazione: niente', async () => {
    const res = await PUT(req('PUT', { base: [], plan: [] }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
  });
});

describe('le letture non dicono chi interviene', () => {
  it('GET completo: la select non chiede la persona', async () => {
    mockedItems.mockResolvedValue([]);
    (prisma.agendaItemReaction.groupBy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await GET(req('GET', undefined, ''), ctx());
    const select = (mockedItems.mock.calls[0]?.[0] as { select: Record<string, unknown> }).select;
    expect(select).not.toHaveProperty('speakerGrantId');
    expect(select).not.toHaveProperty('speakerPrimary');
    expect(select).not.toHaveProperty('speaker');
  });

  it('GET ?lite=1: idem', async () => {
    mockedItems.mockResolvedValue([]);
    await GET(req('GET', undefined, '', '?lite=1'), ctx());
    const select = (mockedItems.mock.calls[0]?.[0] as { select: Record<string, unknown> }).select;
    expect(Object.keys(select).sort()).toEqual(
      ['completedAt', 'id', 'label', 'plannedMinutes', 'startedAt', 'status'],
    );
  });
});
