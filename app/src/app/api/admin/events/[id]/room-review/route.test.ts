// @vitest-environment node
/**
 * GET /api/admin/events/[id]/room-review — tutte le domande segnate in chat e
 * le parole di ogni giro, per la revisione della sala.
 */

import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireEventManager: vi.fn(async () => ({ role: 'admin', accountId: null })),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: vi.fn() },
    eventModerator: { findUnique: vi.fn() },
    chatMessage: { findMany: vi.fn() },
    wordCloudRound: { findMany: vi.fn() },
  },
}));

import { requireEventManager } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { ForbiddenError } from '@/lib/errors';

import { GET } from './route';

const mockedManager = vi.mocked(requireEventManager);
const db = prisma as unknown as {
  event: { findUnique: ReturnType<typeof vi.fn> };
  eventModerator: { findUnique: ReturnType<typeof vi.fn> };
  chatMessage: { findMany: ReturnType<typeof vi.fn> };
  wordCloudRound: { findMany: ReturnType<typeof vi.fn> };
};

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'TOKEN_MODERATORE_PRINCIPALE';

function chiama(token?: string) {
  return GET(
    new Request(
      `https://webinar.example.gov.it/api/admin/events/${EVENT_ID}/room-review`,
      {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }
    ) as unknown as NextRequest,
    { params: Promise.resolve({ id: EVENT_ID }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedManager.mockResolvedValue({ role: 'admin', accountId: null } as Awaited<
    ReturnType<typeof requireEventManager>
  >);
  db.event.findUnique.mockResolvedValue({ id: EVENT_ID, moderatorToken: TOKEN });
  db.eventModerator.findUnique.mockResolvedValue(null);
  // Due letture: le domande aperte, poi le chiuse.
  db.chatMessage.findMany.mockImplementation(
    async ({ where }: { where: { answeredAt?: null } }) =>
      'answeredAt' in where
        ? [
            {
              id: 'm1',
              senderName: 'Luca',
              text: 'Quando esce il video?',
              createdAt: new Date('2026-10-10T10:00:00Z'),
              answeredAt: null,
              dismissedAt: null,
            },
          ]
        : []
  );
  db.wordCloudRound.findMany.mockResolvedValue([
    {
      id: 'r1',
      prompt: 'Primo giro',
      createdAt: new Date('2026-10-10T10:10:00Z'),
      submissions: [
        { word: 'Riuso', registrationId: null, guestId: 'a' },
        { word: 'riuso', registrationId: null, guestId: 'b' },
      ],
    },
    {
      id: 'r2',
      prompt: 'Secondo giro',
      createdAt: new Date('2026-10-10T10:20:00Z'),
      submissions: [],
    },
  ]);
});

describe('GET /api/admin/events/[id]/room-review', () => {
  it('chi modera: tutte le domande in chat e le parole di ogni giro, contate per persona', async () => {
    const res = await chiama(TOKEN);
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as {
      domandeChat: { id: string; text: string }[];
      giri: { id: string; words: { word: string; count: number }[] }[];
    };
    expect(corpo.domandeChat).toEqual([
      expect.objectContaining({ id: 'm1', text: 'Quando esce il video?' }),
    ]);
    expect(corpo.giri.map((g) => g.id)).toEqual(['r1', 'r2']);
    expect(corpo.giri[0]!.words).toEqual([{ word: 'riuso', count: 2 }]);
    expect(db.chatMessage.findMany.mock.calls[0]![0]).toMatchObject({
      where: { eventId: EVENT_ID, isQuestion: true, hiddenAt: null, answeredAt: null },
    });
    expect(mockedManager).not.toHaveBeenCalled();
  });

  it("oltre il tetto: tutte le aperte per prime, poi le chiuse piu' recenti in ordine di tempo", async () => {
    const riga = (id: string, minuto: number, chiusa: boolean) => ({
      id,
      senderName: 'Ospite',
      text: id,
      createdAt: new Date(Date.UTC(2026, 9, 10, 10, minuto)),
      answeredAt: chiusa ? new Date('2026-10-10T12:00:00Z') : null,
      dismissedAt: null,
    });
    const aperte = [riga('a1', 0, false), riga('a2', 1, false)];
    // le chiuse arrivano dalla piu' recente: 1001 righe, una oltre il tetto
    const chiuse = Array.from({ length: 1001 }, (_, i) => riga(`c${1000 - i}`, 0, true));
    db.chatMessage.findMany.mockImplementation(
      async ({ where }: { where: { answeredAt?: null } }) =>
        'answeredAt' in where ? aperte : chiuse
    );
    const corpo = (await (await chiama(TOKEN)).json()) as {
      domandeTroncate: boolean;
      domandeChat: { id: string }[];
    };
    expect(corpo.domandeTroncate).toBe(true);
    expect(corpo.domandeChat).toHaveLength(1000);
    expect(corpo.domandeChat.slice(0, 2).map((d) => d.id)).toEqual(['a1', 'a2']);
    // delle chiuse restano le 998 piu' recenti, dalla meno recente
    expect(corpo.domandeChat[2]!.id).toBe('c3');
    expect(corpo.domandeChat.at(-1)!.id).toBe('c1000');
  });

  it('senza token decide la sessione dello staff', async () => {
    mockedManager.mockRejectedValue(new ForbiddenError('no'));
    expect((await chiama()).status).toBe(403);
    expect(db.chatMessage.findMany).not.toHaveBeenCalled();
  });
});
