// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Il resoconto dell'evento ha regole sue per la chiusura (lib/report/job);
 * gli altri lavori seguono quelle di sempre.
 */
const m = vi.hoisted(() => ({
  job: vi.fn(),
  aggiorna: vi.fn(),
  registrazione: vi.fn(),
  impostazioni: vi.fn(async () => ({ aiJobMaxAttempts: 2 })),
  resoconto: vi.fn(),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/report/job', () => ({ avanzamentoLavoroEvento: m.resoconto }));
vi.mock('@/lib/db', () => ({
  prisma: {
    postprodJob: { findUnique: m.job, update: m.aggiorna },
    recording: { update: m.registrazione },
    siteSetting: { findUnique: m.impostazioni },
  },
}));

import { POST } from './route';

const JOB = '11111111-2222-4333-8444-555555555555';
const avanza = (body: unknown) =>
  POST(
    new Request('http://x/api/internal/postprod-progress', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: JOB, ...(body as object) }),
    }) as never,
    { params: Promise.resolve({}) } as never,
  );
const lavoro = (extra: object) => ({
  id: JOB,
  kind: 'REPORT',
  status: 'RUNNING',
  attempts: 1,
  startedAt: null,
  recordingId: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/internal/postprod-progress', () => {
  it('il resoconto risponde con le sue regole, senza i dettagli interni', async () => {
    m.job.mockResolvedValue(lavoro({}));
    m.resoconto.mockResolvedValueOnce({ status: 'DONE', chiusoOra: true });
    const res = await avanza({ status: 'FAILED', error: 'x', workerId: 'w1', attempt: 1 });
    expect(await res.json()).toEqual({ ok: true, status: 'DONE' });
    expect(m.resoconto.mock.calls[0]![1]).toMatchObject({ status: 'FAILED', workerId: 'w1', attempt: 1 });
    expect(m.resoconto.mock.calls[0]![2]).toMatchObject({ ritardoMs: 30_000 });
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('la traduzione dei testi dell\'evento segue le stesse regole del resoconto', async () => {
    m.job.mockResolvedValue(lavoro({ kind: 'TRANSLATE_TEXT' }));
    m.resoconto.mockResolvedValueOnce({ status: 'RUNNING' });
    const res = await avanza({ status: 'DONE', attempt: 1 });
    expect(await res.json()).toEqual({ ok: true, status: 'RUNNING' });
    expect(m.resoconto).toHaveBeenCalledTimes(1);
    // Un DONE del worker non chiude il lavoro: lo chiude solo la consegna.
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('gli altri lavori restano come prima', async () => {
    m.job.mockResolvedValue(lavoro({ kind: 'SUMMARIZE', recordingId: 'rec-1', attempts: 2 }));
    await avanza({ status: 'FAILED', error: 'x' });
    expect(m.resoconto).not.toHaveBeenCalled();
    expect(m.aggiorna.mock.calls[0]![0].data).toMatchObject({ status: 'FAILED' });
    expect(m.registrazione).toHaveBeenCalledWith({ where: { id: 'rec-1' }, data: { status: 'POSTPROD_PARTIAL' } });
  });
});
