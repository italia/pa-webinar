// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as Accodamento from '@/lib/text-translation/enqueue';

const m = vi.hoisted(() => ({
  accoda: vi.fn(),
  stato: vi.fn(),
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
}));
vi.mock('@/lib/text-translation/auto', () => ({ statoTestiEvento: m.stato }));
vi.mock('@/lib/db', () => ({
  prisma: { siteSetting: { findUnique: m.impostazioni } },
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
const ambiente = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_MT_BASE_URL = 'http://videocall-pa-webinar-mt:8080/v1';
  m.impostazioni.mockResolvedValue({
    aiPipelineEnabled: true,
    availableLocales: ['it', 'en', 'de', 'fr'],
    defaultLocale: 'it',
  });
  m.accoda.mockResolvedValue({ stato: 'accodato', jobId: 'job-1', lingue: ['de', 'en'] });
});
afterEach(() => {
  process.env = { ...ambiente };
});

describe('POST /api/admin/events/[id]/text-translation — «Riprova» e «Ritraduci»', () => {
  it("di chi gestisce l'evento: accoda sul testo salvato e lascia traccia", async () => {
    const res = await chiama(POST, { lingue: ['en', 'DE'] });
    expect(res.status).toBe(202);
    expect(m.gestore.mock.calls[0]![1]).toBe(ID);
    expect(m.accoda).toHaveBeenCalledWith(ID, { lingue: ['en', 'de'] });
    expect(m.audit.mock.calls[0]![0]).toMatchObject({
      action: 'EVENT_TEXT_TRANSLATION_REQUESTED',
      target: ID,
      details: { targetLanguages: ['de', 'en'] },
    });
  });

  it("gia' in corso o niente da tradurre: nessuna traccia, nessun lavoro nuovo", async () => {
    m.accoda.mockResolvedValueOnce({ stato: 'in-corso', jobId: 'job-0' });
    expect((await chiama(POST, { lingue: ['en'] })).status).toBe(200);
    m.accoda.mockResolvedValueOnce({ stato: 'nessuna' });
    expect(await (await chiama(POST, { lingue: ['en'] })).json()).toEqual({ stato: 'nessuna' });
    m.accoda.mockResolvedValueOnce({ stato: 'senza-testo' });
    expect((await chiama(POST, { lingue: ['en'] })).status).toBe(422);
    expect(m.audit).not.toHaveBeenCalled();
  });

  it('pipeline spenta o motore assente: 422 con il codice che il wizard traduce', async () => {
    m.impostazioni.mockResolvedValueOnce({ aiPipelineEnabled: false, availableLocales: ['it', 'en'] });
    let res = await chiama(POST, { lingue: ['en'] });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('AI_PIPELINE_DISABLED');
    delete process.env.AI_MT_BASE_URL;
    res = await chiama(POST, { lingue: ['en'] });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('MT_UNAVAILABLE');
    expect(m.accoda).not.toHaveBeenCalled();
  });

  it('solo lingue attive sul sito, non la principale', async () => {
    for (const corpo of [{ lingue: ['en', 'pl'] }, { lingue: ['it'] }, { lingue: [] }, {}]) {
      expect((await chiama(POST, corpo)).status).toBe(422);
    }
    expect(m.accoda).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/events/[id]/text-translation', () => {
  it('lo stato delle lingue dell evento, di chi lo gestisce', async () => {
    const stato = {
      engine: 'available',
      principale: 'it',
      lingue: [{ code: 'it', page: true, event: true, state: 'principale', origin: null, current: true }],
      job: null,
      testi: { title: {}, description: {} },
    };
    m.stato.mockResolvedValueOnce(stato);
    expect(await (await chiama(GET)).json()).toEqual(stato);
    expect(m.gestore.mock.calls[0]![1]).toBe(ID);
    m.stato.mockResolvedValueOnce(null);
    expect((await chiama(GET)).status).toBe(404);
  });
});
