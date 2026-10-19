// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * La consegna delle traduzioni di titolo e descrizione: solo le lingue
 * chieste, solo dal claim corrente, e la proposta salvata nella stessa
 * transazione che chiude il lavoro.
 */
const m = vi.hoisted(() => ({
  lavoro: vi.fn(),
  chiudi: vi.fn(),
  stato: vi.fn(),
  salva: vi.fn(),
}));
vi.mock('@/lib/auth/cron', () => ({ assertCronApiKey: vi.fn() }));
vi.mock('@/lib/report/job', () => ({
  consegnaLavoroEvento: m.chiudi,
  statoLavoroEvento: m.stato,
}));
vi.mock('@/lib/text-translation/enqueue', () => ({ salvaTraduzioni: m.salva }));
vi.mock('@/lib/db', () => ({
  prisma: {
    postprodJob: { findUnique: m.lavoro },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ tx: true }),
  },
}));

import { POST } from './route';

const JOB = '11111111-2222-4333-8444-555555555555';
const EVENTO = '66666666-7777-4888-8999-000000000000';
const payload = {
  eventId: EVENTO,
  sourceLanguage: 'it',
  targetLanguages: ['de', 'en'],
  title: 'Ciclo | Titolo',
  description: 'Testo',
  sourceHash: 'a'.repeat(64),
};
const consegna = (body: object) =>
  POST(
    new Request('http://x/api/internal/event-text-translation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: JOB, ...body }),
    }) as never,
    { params: Promise.resolve({}) } as never
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.lavoro.mockResolvedValue({
    kind: 'TRANSLATE_TEXT',
    status: 'RUNNING',
    payload,
    startedAt: null,
  });
  m.chiudi.mockResolvedValue(payload);
  m.salva.mockResolvedValue({ title: { en: 'Cycle | Title' } });
});

describe('POST /api/internal/event-text-translation', () => {
  it('chiude il lavoro e salva la proposta nella stessa transazione', async () => {
    const res = await consegna({
      attempt: 2,
      title: { en: 'Cycle | Title' },
      description: { de: 'Text' },
      modelId: 'm',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, languages: ['de', 'en'] });
    expect(m.chiudi).toHaveBeenCalledWith(JOB, 2, 'TRANSLATE_TEXT', { tx: true });
    expect(m.salva.mock.calls[0]![0]).toMatchObject({
      eventId: EVENTO,
      sourceHash: payload.sourceHash,
      sourceTitle: 'Ciclo | Titolo',
      title: { en: 'Cycle | Title' },
      description: { de: 'Text' },
      modelId: 'm',
    });
    expect(m.salva.mock.calls[0]![1]).toEqual({ tx: true });
  });

  it('una lingua non chiesta si rifiuta', async () => {
    const res = await consegna({ attempt: 2, title: { fr: 'Titre' }, description: {} });
    expect(res.status).toBe(422);
    expect(m.chiudi).not.toHaveBeenCalled();
  });

  it("un lavoro gia' chiuso o di un altro tipo", async () => {
    m.lavoro.mockResolvedValueOnce({ kind: 'TRANSLATE_TEXT', status: 'DONE', payload });
    expect(
      await (await consegna({ attempt: 2, title: {}, description: {} })).json()
    ).toEqual({
      ok: true,
      alreadyDelivered: true,
    });
    m.lavoro.mockResolvedValueOnce({ kind: 'TRANSLATE_TEXT', status: 'FAILED', payload });
    expect(await (await consegna({ attempt: 2 })).json()).toMatchObject({ closed: true });
    m.lavoro.mockResolvedValueOnce({ kind: 'REPORT', status: 'RUNNING', payload });
    expect((await consegna({ attempt: 2 })).status).toBe(404);
    expect(m.salva).not.toHaveBeenCalled();
  });

  it('senza il numero del claim non si consegna', async () => {
    expect((await consegna({ title: { en: 'x' } })).status).toBe(409);
  });

  it('superato da un claim successivo: chi consegna lo legge e si ferma', async () => {
    m.chiudi.mockResolvedValueOnce(null);
    m.stato.mockResolvedValueOnce({ status: 'CLAIMED', superseded: true });
    expect(await (await consegna({ attempt: 1, title: { en: 'x' } })).json()).toEqual({
      ok: false,
      superseded: true,
    });
    expect(m.salva).not.toHaveBeenCalled();
  });
});
