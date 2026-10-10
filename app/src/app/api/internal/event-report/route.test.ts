// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ job: vi.fn(), salva: vi.fn(), aggiorna: vi.fn() }));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { postprodJob: { findUnique: m.job, update: m.aggiorna } } }));
vi.mock('@/lib/report/enqueue', () => ({ salvaResoconto: m.salva }));

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
  m.job.mockResolvedValue({
    kind: 'REPORT',
    status: 'RUNNING',
    payload: { eventId: EV, sourceLanguage: 'it', targetLanguages: ['en'], metrics: { version: 1 } },
  });
  m.salva.mockResolvedValue({ narratives: { it: {}, en: {} } });
});

describe('POST /api/internal/event-report', () => {
  it('salva il testo con i numeri del lavoro, non con quelli del worker', async () => {
    const res = await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } }, modelId: 'm' });
    expect(res.status).toBe(200);
    expect(m.salva).toHaveBeenCalledWith({
      eventId: EV,
      sourceLanguage: 'it',
      metrics: { version: 1 },
      narratives: { it: { abstract: 'x' } },
      modelId: 'm',
      modelVersion: null,
    });
  });

  it('rifiuta un lavoro che non e\' un resoconto o non e\' in corso', async () => {
    m.job.mockResolvedValueOnce({ kind: 'SUMMARIZE', status: 'RUNNING', payload: {} });
    expect((await invia({ jobId: JOB, narratives: {} })).status).toBe(404);
    m.job.mockResolvedValueOnce({ kind: 'REPORT', status: 'DONE', payload: {} });
    expect((await invia({ jobId: JOB, narratives: {} })).status).toBe(409);
    expect(m.salva).not.toHaveBeenCalled();
  });

  it('senza testo utilizzabile nella lingua dell\'evento risponde 422', async () => {
    m.salva.mockResolvedValueOnce(null);
    expect((await invia({ jobId: JOB, narratives: { it: {} } })).status).toBe(422);
  });

  it('consegnato il resoconto, il lavoro non tiene piu\' una copia dei numeri', async () => {
    await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } } });
    expect(m.aggiorna).toHaveBeenCalledWith({
      where: { id: JOB },
      data: { payload: { eventId: EV, sourceLanguage: 'it', targetLanguages: ['en'] } },
    });
  });

  it('senza resoconto salvato i numeri restano al lavoro', async () => {
    m.salva.mockResolvedValueOnce(null);
    await invia({ jobId: JOB, narratives: { it: {} } });
    expect(m.aggiorna).not.toHaveBeenCalled();
  });

  it('una seconda consegna dello stesso lavoro non toglie i numeri al resoconto', async () => {
    m.job.mockResolvedValueOnce({
      kind: 'REPORT',
      status: 'RUNNING',
      payload: { eventId: EV, sourceLanguage: 'it', targetLanguages: ['en'] },
    });
    const res = await invia({ jobId: JOB, narratives: { it: { abstract: 'x' } } });
    expect(res.status).toBe(409);
    expect(m.salva).not.toHaveBeenCalled();
  });
});
