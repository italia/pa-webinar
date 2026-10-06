/**
 * Il moderatore toglie una parola da «In una parola».
 */
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => {
  const prisma: Record<string, unknown> = {
    event: { findUnique: vi.fn() },
    wordCloudRound: { findUnique: vi.fn() },
    wordCloudSubmission: { updateMany: vi.fn(), findMany: vi.fn() },
    $executeRaw: vi.fn(async () => 1),
  };
  // La transazione lavora sullo stesso oggetto: i controlli restano visibili.
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock('@/lib/auth/moderator', () => ({
  extractModeratorToken: (req: Request) =>
    req.headers.get('authorization')?.replace(/^Bearer\s+/, '') || null,
  isEventModerator: vi.fn(async (_e: unknown, token: string) => token === 'MOD'),
}));
vi.mock('@/lib/live-state/publish', () => ({ pokeLivePanel: vi.fn() }));

import { prisma } from '@/lib/db';
import { pokeLivePanel } from '@/lib/live-state/publish';

import { DELETE } from './route';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const ROUND_ID = '66666666-6666-4666-8666-666666666666';
const SLUG = 'evento-di-prova';

const mockedEvent = prisma.event.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedRound = prisma.wordCloudRound.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockedHide = prisma.wordCloudSubmission.updateMany as unknown as ReturnType<typeof vi.fn>;
const mockedRows = prisma.wordCloudSubmission.findMany as unknown as ReturnType<typeof vi.fn>;

const ctx = () => ({ params: Promise.resolve({ param: SLUG, id: ROUND_ID }) });
const del = (word: string, token?: string) =>
  new Request(
    `https://webinar.gov.it/api/events/${SLUG}/wordcloud/${ROUND_ID}/words?word=${encodeURIComponent(word)}`,
    { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} },
  ) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockedEvent.mockResolvedValue({ id: EVENT_ID });
  mockedRound.mockResolvedValue({ id: ROUND_ID, eventId: EVENT_ID });
  mockedHide.mockResolvedValue({ count: 3 });
  mockedRows.mockResolvedValue([
    { id: 's1', word: 'brutta' },
    { id: 's2', word: 'brutta' },
    // Salvata prima della normalizzazione: si toglie lo stesso.
    { id: 's3', word: 'Brutta!' },
    { id: 's4', word: 'bella' },
  ]);
});

describe('DELETE /api/events/[slug]/wordcloud/[id]/words', () => {
  it('senza token: 401; con un token che non modera: 403', async () => {
    expect((await DELETE(del('dati'), ctx())).status).toBe(401);
    expect((await DELETE(del('dati', 'ALTRO'), ctx())).status).toBe(403);
    expect(mockedHide).not.toHaveBeenCalled();
  });

  it('nasconde tutte le righe della parola, nella forma con cui si conta, e avvisa la sala', async () => {
    const res = await DELETE(del('Brutta!', 'MOD'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ word: 'brutta', hidden: 3 });
    expect(mockedRows).toHaveBeenCalledWith(
      expect.objectContaining({ where: { roundId: ROUND_ID, hiddenAt: null } }),
    );
    expect(mockedHide).toHaveBeenCalledWith({
      where: { id: { in: ['s1', 's2', 's3'] }, hiddenAt: null },
      data: { hiddenAt: expect.any(Date) },
    });
    expect(pokeLivePanel).toHaveBeenCalledWith(EVENT_ID, 'wordcloud');
  });

  it('niente da nascondere: nessun avviso', async () => {
    const res = await DELETE(del('assente', 'MOD'), ctx());
    expect(await res.json()).toEqual({ word: 'assente', hidden: 0 });
    expect(mockedHide).not.toHaveBeenCalled();
    expect(pokeLivePanel).not.toHaveBeenCalled();
  });

  it('una parola di soli simboli non e’ una parola', async () => {
    expect((await DELETE(del('!!!', 'MOD'), ctx())).status).toBe(422);
  });

  it('un giro di un altro evento non si tocca', async () => {
    mockedRound.mockResolvedValue({ id: ROUND_ID, eventId: 'altro' });
    expect((await DELETE(del('dati', 'MOD'), ctx())).status).toBe(404);
    expect(mockedHide).not.toHaveBeenCalled();
  });
});
