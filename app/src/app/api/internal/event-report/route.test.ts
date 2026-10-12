// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  job: vi.fn(),
  salva: vi.fn(),
  prendi: vi.fn(),
  stato: vi.fn(async (): Promise<{ status: string; superseded?: true }> => ({ status: 'DONE' })),
  tx: { marker: 'tx' },
  annullata: false,
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    postprodJob: { findUnique: m.job },
    // La transazione: se la funzione lancia, si annulla (i numeri restano al lavoro).
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
      try {
        return await fn(m.tx);
      } catch (e) {
        m.annullata = true;
        throw e;
      }
    }),
  },
}));
vi.mock('@/lib/report/enqueue', () => ({ salvaResoconto: m.salva }));
vi.mock('@/lib/report/job', () => ({ consegnaResoconto: m.prendi, statoResoconto: m.stato }));

import { POST } from './route';

const JOB = '11111111-2222-4333-8444-555555555555';
const EV = '99999999-8888-4777-8666-555555555555';
const invia = (body: unknown) =>
  POST(
    new Request('http://x/api/internal/event-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({}) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.annullata = false;
  m.job.mockResolvedValue({
    kind: 'REPORT',
    status: 'RUNNING',
    payload: { eventId: EV, sourceLanguage: 'it', targetLanguages: ['en'], metrics: { version: 1 } },
  });
  m.prendi.mockResolvedValue({ version: 1 });
  m.salva.mockResolvedValue({ narratives: { it: {}, en: {} } });
});

describe('POST /api/internal/event-report', () => {
  it('salva il testo con i numeri presi dal lavoro, che si chiude nella stessa transazione', async () => {
    const res = await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } }, modelId: 'm', attempt: 2 });
    expect(res.status).toBe(200);
    expect(m.prendi).toHaveBeenCalledWith(JOB, 2, m.tx);
    expect(m.salva).toHaveBeenCalledWith(
      {
        eventId: EV,
        sourceLanguage: 'it',
        metrics: { version: 1 },
        narratives: { it: { abstract: 'x' } },
        modelId: 'm',
        modelVersion: null,
      },
      m.tx,
    );
  });

  it('rifiuta un lavoro che non e\' un resoconto o e\' fallito; uno concluso e\' gia\' consegnato', async () => {
    m.job.mockResolvedValueOnce({ kind: 'SUMMARIZE', status: 'RUNNING', payload: {} });
    expect((await invia({ jobId: JOB, narratives: {} })).status).toBe(404);
    m.job.mockResolvedValueOnce({ kind: 'REPORT', status: 'FAILED', payload: {} });
    expect(await (await invia({ jobId: JOB, narratives: {} })).json()).toEqual({ ok: false, closed: true, status: 'FAILED' });
    // Senza il numero del claim la consegna non vale.
    expect((await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } } })).status).toBe(409);
    m.job.mockResolvedValueOnce({ kind: 'REPORT', status: 'DONE', payload: {} });
    expect(await (await invia({ jobId: JOB, narratives: {} })).json()).toEqual({ ok: true, alreadyDelivered: true });
    expect(m.salva).not.toHaveBeenCalled();
  });

  it('senza testo utilizzabile risponde 422 e i numeri restano al lavoro', async () => {
    m.salva.mockResolvedValueOnce(null);
    expect((await invia({ jobId: JOB, narratives: { it: {} }, attempt: 2 })).status).toBe(422);
    expect(m.annullata).toBe(true);
  });

  it('una seconda consegna dello stesso lavoro lascia il resoconto gia\' salvato', async () => {
    m.prendi.mockResolvedValueOnce(null);
    const res = await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } }, attempt: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, alreadyDelivered: true });
    expect(m.salva).not.toHaveBeenCalled();
  });

  it('senza numeri e senza consegna il lavoro non ha niente da consegnare', async () => {
    m.prendi.mockResolvedValueOnce(null);
    m.stato.mockResolvedValueOnce({ status: 'RUNNING' });
    expect((await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } }, attempt: 2 })).status).toBe(409);
  });

  it('il lease e\' di un altro worker: chi consegna lo legge e si ferma', async () => {
    m.prendi.mockResolvedValueOnce(null);
    m.stato.mockResolvedValueOnce({ status: 'CLAIMED', superseded: true });
    const res = await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } }, attempt: 1 });
    expect(await res.json()).toEqual({ ok: false, superseded: true });
    expect(m.salva).not.toHaveBeenCalled();
  });
});
