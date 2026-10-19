// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Accodamento from '@/lib/text-translation/enqueue';
import { improntaSorgente } from '@/lib/text-translation/source';

const m = vi.hoisted(() => ({
  accoda: vi.fn(),
  ultimo: vi.fn(async () => null),
  evento: vi.fn(),
  impostazioni: vi.fn(),
  audit: vi.fn(),
  gestore: vi.fn(async (..._a: unknown[]) => ({ role: 'organizer' })),
}));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({ requireEventManager: m.gestore }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: m.audit }));
vi.mock('@/lib/text-translation/enqueue', async (orig) => ({
  ...(await orig<typeof Accodamento>()),
  accodaTraduzioneTesti: m.accoda,
  ultimoLavoroTraduzione: m.ultimo,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    event: { findUnique: m.evento },
    siteSetting: { findUnique: m.impostazioni },
  },
}));

import { GET, POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const chiama = (fn: typeof POST, body?: unknown) =>
  fn(
    new Request(`http://x/api/admin/events/${ID}/text-translation`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }) as never,
    { params: Promise.resolve({ id: ID }) } as never
  );
const richiesta = {
  sourceLanguage: 'it',
  title: 'Ciclo | Titolo',
  description: 'Testo della descrizione',
  targetLanguages: ['en', 'de'],
};
const ambiente = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
  m.impostazioni.mockResolvedValue({
    aiPipelineEnabled: true,
    availableLocales: ['it', 'en', 'de', 'fr'],
  });
  m.accoda.mockResolvedValue({ stato: 'accodato', jobId: 'job-1' });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('POST /api/admin/events/[id]/text-translation', () => {
  it("di chi gestisce l'evento: accoda il testo del modulo e lascia traccia", async () => {
    const res = await chiama(POST, richiesta);
    expect(res.status).toBe(202);
    expect(m.gestore.mock.calls[0]![1]).toBe(ID);
    expect(m.accoda).toHaveBeenCalledWith(
      ID,
      {
        sourceLanguage: 'it',
        title: 'Ciclo | Titolo',
        description: 'Testo della descrizione',
      },
      ['en', 'de']
    );
    expect(m.audit.mock.calls[0]![0]).toMatchObject({
      action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
      target: ID,
    });
  });

  it("gia' in corso o gia' pronta: nessuna traccia, nessun lavoro nuovo", async () => {
    m.accoda.mockResolvedValueOnce({
      stato: 'in-corso',
      jobId: 'job-0',
      sourceHash: null,
    });
    expect((await chiama(POST, richiesta)).status).toBe(200);
    m.accoda.mockResolvedValueOnce({ stato: 'pronto' });
    expect(await (await chiama(POST, richiesta)).json()).toEqual({ stato: 'pronto' });
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('pipeline spenta o motore assente: 422 con il codice che il wizard traduce', async () => {
    m.impostazioni.mockResolvedValueOnce({
      aiPipelineEnabled: false,
      availableLocales: ['it', 'en'],
    });
    let res = await chiama(POST, richiesta);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('AI_PIPELINE_DISABLED');
    delete process.env.AI_MT_BASE_URL;
    res = await chiama(POST, richiesta);
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('MT_UNAVAILABLE');
    expect(m.accoda).not.toHaveBeenCalled();
  });

  it("solo le lingue attive dell'istanza, senza quella di partenza, e un testo da tradurre", async () => {
    for (const corpo of [
      { ...richiesta, targetLanguages: ['en', 'pl'] },
      { ...richiesta, targetLanguages: ['it'] },
      { ...richiesta, sourceLanguage: 'pl' },
      { ...richiesta, targetLanguages: [] },
      { ...richiesta, title: '  ', description: '' },
      { ...richiesta, description: 'x'.repeat(10_001) },
    ]) {
      expect((await chiama(POST, corpo)).status).toBe(422);
    }
    expect(m.accoda).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/events/[id]/text-translation', () => {
  it("dice se la traduzione c'e' e quali lingue la proposta riempirebbe nel testo salvato", async () => {
    const impronta = await improntaSorgente({
      sourceLanguage: 'it',
      title: 'Titolo',
      description: 'Testo',
    });
    m.evento.mockResolvedValue({
      title: { it: 'Titolo', en: 'Mio titolo' },
      description: { it: 'Testo', en: 'Mio testo' },
      textTranslations: {
        version: 1,
        sourceLanguage: 'it',
        sourceHash: impronta,
        generatedAt: '',
        model: { id: 'm', version: null },
        title: { en: 'Title', de: 'Titel' },
        description: { en: 'Text', de: 'Text' },
      },
    });
    const corpo = await (await chiama(GET)).json();
    expect(corpo).toMatchObject({ available: true, job: null, pending: ['de'] });
    expect(corpo.proposals.title).toEqual({ en: 'Title', de: 'Titel' });

    // Il testo salvato e' cambiato: la proposta non vale piu'.
    m.evento.mockResolvedValue({
      title: { it: 'Titolo nuovo' },
      description: { it: 'Testo' },
      textTranslations: {
        version: 1,
        sourceLanguage: 'it',
        sourceHash: impronta,
        title: { de: 'Titel' },
        description: {},
      },
    });
    m.impostazioni.mockResolvedValue({ aiPipelineEnabled: false });
    expect(await (await chiama(GET)).json()).toMatchObject({
      available: false,
      pending: [],
    });
  });
});
