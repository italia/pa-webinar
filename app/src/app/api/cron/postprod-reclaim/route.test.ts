import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Un lavoro che esaurisce i tentativi porta la sua registrazione a
 * POSTPROD_PARTIAL; il resoconto dell'evento non ha registrazione. Senza
 * motore di traduzione la traduzione dei testi in coda si chiude.
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
const contatore = vi.hoisted(() => ({ inc: vi.fn(), labels: vi.fn() }));
vi.mock('@/lib/metrics', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  postprodJobsCompletedTotal: contatore,
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
  vi.stubEnv('AI_MT_BASE_URL', 'http://pa-webinar-mt.pa-webinar.svc.cluster.local:8080/v1');
  contatore.labels.mockReturnValue(contatore);
  db.siteSetting.findUnique.mockResolvedValue({ aiJobMaxAttempts: 3 });
  db.recording.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it('chiudendo un resoconto esaurito ne toglie la copia dei numeri', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await GET(req() as never, ctx);
    const sql = (db.$queryRaw.mock.calls[1]![0] as string[]).join('?');
    expect(sql).toContain("payload = CASE WHEN kind = 'REPORT' THEN payload - 'metrics' ELSE payload END");
  });

  it('con il motore di traduzione configurato la traduzione dei testi in coda resta', async () => {
    db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await GET(req() as never, ctx);
    expect(await res.json()).toMatchObject({ ok: true, failedNoMtEngine: 0 });
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('senza motore di traduzione chiude la traduzione dei testi in coda, con il motivo', async () => {
    vi.stubEnv('AI_MT_BASE_URL', '');
    db.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ kind: 'TRANSLATE_TEXT' }, { kind: 'TRANSLATE_TEXT' }]);
    const res = await GET(req() as never, ctx);
    expect(await res.json()).toMatchObject({ ok: true, failed: 0, failedNoMtEngine: 2 });
    const [testi, ...valori] = db.$queryRaw.mock.calls[2]! as [string[], ...unknown[]];
    const sql = testi.join('?');
    // Solo i lavori in coda: uno preso ha un worker vivo.
    expect(sql).toMatch(/WHERE status = 'PENDING'\s+AND kind::text = ANY\(\?::text\[\]\)/);
    expect(sql).toContain("SET status = 'FAILED'");
    expect(valori).toContainEqual(['TRANSLATE_TEXT']);
    expect(valori).toContain('The CPU translation engine is not configured (AI_MT_BASE_URL)');
    expect(contatore.labels).toHaveBeenCalledWith('TRANSLATE_TEXT', 'FAILED');
    expect(contatore.inc).toHaveBeenCalledTimes(2);
    // Nessuna registrazione coinvolta.
    expect(db.recording.updateMany).not.toHaveBeenCalled();
  });
});
