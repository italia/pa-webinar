/**
 * Stato e cancellazione di un sondaggio (solo moderatore): cosa finisce nella
 * cronologia della sala.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    poll: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    pollVote: { groupBy: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/cache', () => ({ deleteCacheByPrefix: vi.fn() }));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';

import { DELETE, PATCH } from './route';

const EVENT_ID = '44444444-4444-4444-8444-444444444444';
const POLL_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';
const PRIMARY_TOKEN = 'PRIMARY_MOD_TOKEN';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedPoll = prisma.poll.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.poll.update as unknown as ReturnType<typeof vi.fn>;
const mockedDelete = prisma.poll.delete as unknown as ReturnType<typeof vi.fn>;
const mockedTally = prisma.pollVote.groupBy as unknown as ReturnType<typeof vi.fn>;
const mockedGrant = prisma.eventModerator.findUnique as unknown as ReturnType<typeof vi.fn>;

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: POLL_ID }) });
const req = (method: string, body?: unknown, token = PRIMARY_TOKEN) =>
  new Request(`https://webinar.gov.it/api/events/${SLUG}/polls/${POLL_ID}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;

function pollRow(over: Record<string, unknown> = {}) {
  return {
    id: POLL_ID,
    eventId: EVENT_ID,
    question: 'Ti è stato utile?',
    options: ['Sì', 'No', 'Così così'],
    status: 'OPEN',
    createdAt: new Date('2026-09-22T10:00:00.000Z'),
    closedAt: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID, moderatorToken: PRIMARY_TOKEN });
  mockedGrant.mockResolvedValue(null);
  mockedPoll.mockResolvedValue(pollRow());
  mockedUpdate.mockImplementation(async (args: { data: { status: string; closedAt: Date | null } }) =>
    pollRow(args.data),
  );
  mockedDelete.mockResolvedValue(pollRow());
  mockedTally.mockResolvedValue([
    { optionIndex: 0, _count: { _all: 5 } },
    { optionIndex: 2, _count: { _all: 2 } },
  ]);
});

describe('PATCH /api/events/[slug]/polls/[id] — cronologia', () => {
  it('chiudere registra domanda, opzioni e risultati di quel momento', async () => {
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx());
    expect(res.status).toBe(200);
    expect(mockedTally).toHaveBeenCalledWith({
      by: ['optionIndex'],
      where: { pollId: POLL_ID },
      _count: { _all: true },
    });
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'poll.closed',
      actor: 'moderator',
      data: {
        pollId: POLL_ID,
        question: 'Ti è stato utile?',
        options: ['Sì', 'No', 'Così così'],
        counts: [5, 0, 2],
        totalVotes: 7,
      },
    });
  });

  it('pubblicare un sondaggio chiuso registra la pubblicazione', async () => {
    mockedPoll.mockResolvedValue(pollRow({ status: 'CLOSED' }));
    await PATCH(req('PATCH', { status: 'PUBLISHED' }), ctx());
    expect(recordLiveAction).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'poll.published',
        data: expect.objectContaining({ counts: [5, 0, 2], totalVotes: 7 }),
      }),
    );
  });

  it('riaprire registra solo id e domanda', async () => {
    mockedPoll.mockResolvedValue(pollRow({ status: 'CLOSED' }));
    await PATCH(req('PATCH', { status: 'OPEN' }), ctx());
    expect(mockedTally).not.toHaveBeenCalled();
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'poll.reopened',
      actor: 'moderator',
      data: { pollId: POLL_ID, question: 'Ti è stato utile?' },
    });
  });

  it('lo stesso stato di prima non è un passaggio: niente in cronologia', async () => {
    mockedPoll.mockResolvedValue(pollRow({ status: 'CLOSED' }));
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx());
    expect(res.status).toBe(200);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('senza moderazione: niente scrittura, niente cronologia', async () => {
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }, 'ALTRO'), ctx());
    expect(res.status).toBe(403);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('un sondaggio di un altro evento è 404 e non si registra', async () => {
    mockedPoll.mockResolvedValue(pollRow({ eventId: 'altro-evento' }));
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx());
    expect(res.status).toBe(404);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/events/[slug]/polls/[id] — cronologia', () => {
  it('cancellare registra id e domanda', async () => {
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(200);
    expect(mockedDelete).toHaveBeenCalledWith({ where: { id: POLL_ID } });
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'poll.deleted',
      actor: 'moderator',
      data: { pollId: POLL_ID, question: 'Ti è stato utile?' },
    });
  });

  it('un sondaggio inesistente è 404 e non si registra', async () => {
    mockedPoll.mockResolvedValue(null);
    const res = await DELETE(req('DELETE'), ctx());
    expect(res.status).toBe(404);
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});
