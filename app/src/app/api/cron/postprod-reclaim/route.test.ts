import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un lavoro che esaurisce i tentativi porta la sua registrazione a
 * POSTPROD_PARTIAL; il resoconto dell'evento non ha registrazione.
 */
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
    recording: { updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/ai/metrics', () => ({
  refreshPostprodGauges: vi.fn(async () => undefined),
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

type Fn = ReturnType<typeof vi.fn>;
const db = prisma as unknown as {
  siteSetting: { findUnique: Fn };
  $queryRaw: Fn;
  recording: { updateMany: Fn };
};
const ctx = { params: Promise.resolve({}) };
const req = () => new Request('https://portale.example.test/api/cron/postprod-reclaim');

beforeEach(() => {
  vi.clearAllMocks();
  db.siteSetting.findUnique.mockResolvedValue({ aiJobMaxAttempts: 3 });
  db.recording.updateMany.mockResolvedValue({ count: 1 });
});

describe('GET /api/cron/postprod-reclaim', () => {
  it('il resoconto esaurito non tocca nessuna registrazione', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'j1', recording_id: 'r-trascrizione', attempts: 3 },
      { id: 'j2', recording_id: null, attempts: 3 },
    ]);
    const res = await GET(req() as never, ctx);
    expect(await res.json()).toMatchObject({ ok: true, failed: 2 });
    expect(db.recording.updateMany).toHaveBeenCalledOnce();
    expect(db.recording.updateMany.mock.calls[0]![0].where.id).toEqual({
      in: ['r-trascrizione'],
    });
  });
});
