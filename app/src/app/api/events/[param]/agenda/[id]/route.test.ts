/**
 * Stato degli argomenti della scaletta: uno solo in corso, e la spunta dei
 * client precedenti che continua a funzionare.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { tx } = vi.hoisted(() => ({
  tx: {
    $executeRaw: vi.fn(),
    eventAgendaItem: {
      updateMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    eventAgendaItem: { findUnique: vi.fn(), delete: vi.fn() },
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
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '77777777-7777-4777-8777-777777777777';

import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';
import { recordLiveAction, recordLiveActions } from '@/lib/live/actions';

import { PATCH } from './route';

const mockedFind = prisma.eventAgendaItem.findUnique as unknown as ReturnType<typeof vi.fn>;
const ctx = () => ({ params: Promise.resolve({ param: 'evento', id: ITEM_ID }) });
const patch = (body: unknown, token = 'MOD') =>
  new Request(`https://webinar.gov.it/api/events/evento/agenda/${ITEM_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFind.mockResolvedValue({ id: ITEM_ID, eventId: EVENT_ID });
  tx.eventAgendaItem.updateMany.mockResolvedValue({ count: 1 });
  tx.eventAgendaItem.findUnique.mockResolvedValue({ status: 'PENDING' });
  tx.eventAgendaItem.findMany.mockResolvedValue([]);
  tx.$executeRaw.mockResolvedValue(1);
  tx.eventAgendaItem.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: ITEM_ID,
    label: 'Apertura',
    ...args.data,
  }));
});

describe('PATCH /api/events/[slug]/agenda/[id]', () => {
  it('avviare un argomento chiude come discusso quello in corso', async () => {
    const res = await PATCH(patch({ status: 'CURRENT' }), ctx());
    expect(res.status).toBe(200);
    expect(tx.eventAgendaItem.updateMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, status: 'CURRENT', id: { not: ITEM_ID } },
      data: expect.objectContaining({ status: 'DONE', completed: true }),
    });
    const scritto = tx.eventAgendaItem.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toMatchObject({ status: 'CURRENT', completed: false });
    expect(scritto.data.startedAt).toBeInstanceOf(Date);
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'agenda');
  });

  it('avviare blocca la scaletta dell’evento per tutta la transazione', async () => {
    await PATCH(patch({ status: 'CURRENT' }), ctx());
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const sql = (tx.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('FOR NO KEY UPDATE');
    // Il blocco viene prima di ogni lettura e scrittura.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.eventAgendaItem.updateMany.mock.invocationCallOrder[0]!,
    );
  });

  it('riavviare quello gia’ in corso non azzera il suo orologio', async () => {
    tx.eventAgendaItem.findUnique.mockResolvedValue({ status: 'CURRENT' });
    await PATCH(patch({ status: 'CURRENT' }), ctx());
    const scritto = tx.eventAgendaItem.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toEqual({});
  });

  it('saltare non tocca gli altri argomenti', async () => {
    await PATCH(patch({ status: 'SKIPPED' }), ctx());
    expect(tx.eventAgendaItem.updateMany).not.toHaveBeenCalled();
    const scritto = tx.eventAgendaItem.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toMatchObject({ status: 'SKIPPED', completed: false });
  });

  it('la spunta dei client precedenti diventa uno stato', async () => {
    await PATCH(patch({ completed: true }), ctx());
    let scritto = tx.eventAgendaItem.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toMatchObject({ status: 'DONE', completed: true });

    await PATCH(patch({ completed: false }), ctx());
    scritto = tx.eventAgendaItem.update.mock.calls[1]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toMatchObject({ status: 'PENDING', completed: false, startedAt: null });
  });

  it('cambiare solo il titolo non tocca lo stato', async () => {
    await PATCH(patch({ label: '  Nuovo titolo ' }), ctx());
    const scritto = tx.eventAgendaItem.update.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(scritto.data).toEqual({ label: 'Nuovo titolo' });
  });

  it('uno stato sconosciuto non passa', async () => {
    const res = await PATCH(patch({ status: 'ARCHIVED' }), ctx());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
  });

  it('senza token di moderazione: niente', async () => {
    const res = await PATCH(patch({ status: 'CURRENT' }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
    expect(tx.eventAgendaItem.update).not.toHaveBeenCalled();
    expect(recordLiveAction).not.toHaveBeenCalled();
    expect(recordLiveActions).not.toHaveBeenCalled();
  });
});

describe('PATCH agenda: cronologia della sala', () => {
  const PRIMA = '88888888-8888-4888-8888-888888888888';

  it('avviare un argomento registra il precedente come discusso e il nuovo in corso', async () => {
    tx.eventAgendaItem.findMany.mockResolvedValue([{ id: PRIMA, label: 'Saluti' }]);
    await PATCH(patch({ status: 'CURRENT' }), ctx());
    // Gli argomenti da chiudere si leggono con la stessa condizione, prima di chiuderli.
    expect(tx.eventAgendaItem.findMany).toHaveBeenCalledWith({
      where: { eventId: EVENT_ID, status: 'CURRENT', id: { not: ITEM_ID } },
      select: { id: true, label: true },
    });
    expect(tx.eventAgendaItem.findMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.eventAgendaItem.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(recordLiveActions).toHaveBeenCalledWith([
      {
        eventId: EVENT_ID,
        kind: 'agenda.topic',
        actor: 'moderator',
        data: { itemId: PRIMA, label: 'Saluti', status: 'DONE' },
        at: expect.any(Date),
      },
    ]);
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'agenda.topic',
      actor: 'moderator',
      data: { itemId: ITEM_ID, label: 'Apertura', status: 'CURRENT' },
      at: expect.any(Date),
    });
    // Nella cronologia il nuovo argomento viene dopo quello chiuso.
    const chiuso = vi.mocked(recordLiveActions).mock.calls[0]?.[0]?.[0]?.at as Date;
    const avviato = vi.mocked(recordLiveAction).mock.calls[0]?.[0]?.at as Date;
    expect(avviato.getTime()).toBeGreaterThan(chiuso.getTime());
  });

  it('riavviare quello gia’ in corso non registra niente', async () => {
    tx.eventAgendaItem.findUnique.mockResolvedValue({ status: 'CURRENT' });
    await PATCH(patch({ status: 'CURRENT' }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
    expect(recordLiveActions).toHaveBeenCalledWith([]);
  });

  it('cambiare solo il titolo non registra niente', async () => {
    await PATCH(patch({ label: 'Nuovo titolo' }), ctx());
    expect(recordLiveAction).not.toHaveBeenCalled();
    expect(recordLiveActions).not.toHaveBeenCalled();
  });

  it('saltare registra solo l’argomento toccato', async () => {
    await PATCH(patch({ status: 'SKIPPED' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'agenda.topic',
        data: { itemId: ITEM_ID, label: 'Apertura', status: 'SKIPPED' },
      }),
    );
  });
});
