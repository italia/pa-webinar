/**
 * Il moderatore chiude una domanda di «In una parola»: cosa finisce nella
 * cronologia della sala.
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    wordCloudRound: { findUnique: vi.fn(), update: vi.fn() },
    wordCloudSubmission: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'MOD'),
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));
vi.mock('@/lib/wordcloud/lite', () => ({ forgetWordcloudLite: vi.fn() }));
vi.mock('@/lib/live/actions', () => ({ recordLiveAction: vi.fn(), recordLiveActions: vi.fn() }));

import { prisma } from '@/lib/db';
import { recordLiveAction } from '@/lib/live/actions';

import { PATCH } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ROUND_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRound = prisma.wordCloudRound.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = prisma.wordCloudRound.update as unknown as ReturnType<typeof vi.fn>;
const mockedRows = prisma.wordCloudSubmission.findMany as unknown as ReturnType<typeof vi.fn>;

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: ROUND_ID }) });
const patch = (token?: string) =>
  new Request(`https://webinar.gov.it/api/events/${SLUG}/wordcloud/${ROUND_ID}`, {
    method: 'PATCH',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID });
  mockedRound.mockResolvedValue({ id: ROUND_ID, eventId: EVENT_ID, status: 'OPEN' });
  mockedUpdate.mockResolvedValue({
    id: ROUND_ID,
    prompt: 'Una parola',
    status: 'CLOSED',
    closedAt: new Date('2026-10-01T10:05:00.000Z'),
  });
  mockedRows.mockResolvedValue([
    { word: 'dati', guestId: 'g1', registrationId: null },
    { word: 'Futuro', guestId: 'g1', registrationId: null },
    { word: 'futuro', guestId: null, registrationId: 'r1' },
  ]);
});

describe('PATCH /api/events/[slug]/wordcloud/[id] — cronologia', () => {
  it('chiudere registra la domanda e le parole visibili più scritte', async () => {
    const res = await PATCH(patch('MOD'), ctx());
    expect(res.status).toBe(200);
    expect(mockedRows).toHaveBeenCalledWith({
      where: { roundId: ROUND_ID, hiddenAt: null },
      select: { word: true, registrationId: true, guestId: true },
    });
    expect(recordLiveAction).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      kind: 'wordcloud.closed',
      actor: 'moderator',
      data: {
        roundId: ROUND_ID,
        prompt: 'Una parola',
        words: [
          { word: 'futuro', count: 2 },
          { word: 'dati', count: 1 },
        ],
      },
    });
  });

  it('al massimo quindici parole', async () => {
    mockedRows.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ word: `parola${i}`, guestId: 'g1', registrationId: null })),
    );
    await PATCH(patch('MOD'), ctx());
    const dati = vi.mocked(recordLiveAction).mock.calls[0]?.[0].data as { words: unknown[] };
    expect(dati.words).toHaveLength(15);
  });

  it('un giro già chiuso non si registra di nuovo', async () => {
    mockedRound.mockResolvedValue({ id: ROUND_ID, eventId: EVENT_ID, status: 'CLOSED' });
    const res = await PATCH(patch('MOD'), ctx());
    expect(res.status).toBe(200);
    expect(recordLiveAction).not.toHaveBeenCalled();
  });

  it('senza moderazione, o su un giro di un altro evento: niente', async () => {
    expect((await PATCH(patch('ALTRO'), ctx())).status).toBe(403);
    mockedRound.mockResolvedValue({ id: ROUND_ID, eventId: 'altro', status: 'OPEN' });
    expect((await PATCH(patch('MOD'), ctx())).status).toBe(404);
    expect(mockedUpdate).not.toHaveBeenCalled();
    expect(recordLiveAction).not.toHaveBeenCalled();
  });
});
