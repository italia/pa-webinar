import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: { liveAction: { create: vi.fn(), createMany: vi.fn() } },
}));

import { prisma } from '@/lib/db';

import { recordLiveAction, recordLiveActions, serverTimeOf } from './actions';

const create = prisma.liveAction.create as unknown as ReturnType<typeof vi.fn>;
const createMany = prisma.liveAction.createMany as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({});
  createMany.mockResolvedValue({ count: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('recordLiveAction', () => {
  it('scrive tipo, ruolo e dati; l’ora la mette il database', async () => {
    await recordLiveAction({ eventId: 'e1', kind: 'poll.opened', actor: 'moderator', data: { pollId: 'p1' } });
    expect(create).toHaveBeenCalledWith({
      data: { eventId: 'e1', kind: 'poll.opened', actor: 'moderator', data: { pollId: 'p1' } },
    });
  });

  it('con un’ora data, usa quella', async () => {
    const at = new Date('2026-10-08T10:00:00Z');
    await recordLiveAction({ eventId: 'e1', kind: 'wordcloud.closed', at });
    expect(create.mock.calls[0]?.[0].data.at).toBe(at);
  });

  it('un errore del database non arriva a chi ha fatto l’azione', async () => {
    create.mockRejectedValueOnce(new Error('giu'));
    await expect(recordLiveAction({ eventId: 'e1', kind: 'event.ended' })).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(console.error).toHaveBeenCalled();
  });

  it('anche un errore immediato resta nel log', async () => {
    create.mockImplementationOnce(() => {
      throw new Error('client non pronto');
    });
    await expect(recordLiveAction({ eventId: 'e1', kind: 'event.ended' })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('non fa aspettare la scrittura a chi ha fatto l’azione', async () => {
    let finisci: () => void = () => {};
    create.mockReturnValueOnce(new Promise<void>((r) => (finisci = r)));
    let risolta = false;
    void recordLiveAction({ eventId: 'e1', kind: 'event.ended' }).then(() => (risolta = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(risolta).toBe(true);
    finisci();
  });

  it('piu’ azioni in una sola scrittura; nessuna, nessuna scrittura', async () => {
    await recordLiveActions([]);
    expect(createMany).not.toHaveBeenCalled();
    await recordLiveActions([
      { eventId: 'e1', kind: 'hand.raised', actor: 'participant' },
      { eventId: 'e1', kind: 'hand.raised', actor: 'participant' },
    ]);
    expect(createMany.mock.calls[0]?.[0].data).toHaveLength(2);
  });
});

describe('serverTimeOf', () => {
  const ARRIVO = Date.parse('2026-10-08T10:00:10Z');

  it('toglie la differenza tra l’orologio del browser e quello del server', () => {
    // Il browser e' avanti di 60 s: il fatto e' alle 10:00:05 del server.
    const fatto = Date.parse('2026-10-08T10:01:05Z');
    const invio = Date.parse('2026-10-08T10:01:10Z');
    expect(serverTimeOf(fatto, invio, ARRIVO).toISOString()).toBe('2026-10-08T10:00:05.000Z');
  });

  it('senza le ore del browser, o con dati senza senso, l’ora di arrivo', () => {
    expect(serverTimeOf(undefined, undefined, ARRIVO).getTime()).toBe(ARRIVO);
    // Nel futuro rispetto all'invio.
    expect(serverTimeOf(ARRIVO + 60_000, ARRIVO, ARRIVO).getTime()).toBe(ARRIVO);
    // Vecchio di due giorni.
    expect(serverTimeOf(ARRIVO - 2 * 86_400_000, ARRIVO, ARRIVO).getTime()).toBe(ARRIVO);
  });
});
