// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ registrazione: vi.fn(), trascrizione: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireRecordingManager: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/ai/enqueue', () => ({ enqueueTranslateLanguage: vi.fn(async () => ({ enqueued: true, dubEnqueued: false })) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: vi.fn(async () => ({ aiPipelineEnabled: true })) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ recording: { findUnique: m.registrazione }, postprodArtifact: { findFirst: m.trascrizione } }),
    ),
  },
}));

import { POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const traduci = (targetLanguage: string) =>
  POST(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/translations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetLanguage }),
    }) as never,
    { params: Promise.resolve({ id: ID }) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.registrazione.mockResolvedValue({ id: ID, sourceLanguage: 'it' });
  m.trascrizione.mockResolvedValue(null);
});

describe('POST translations: i codici delle condizioni che l\'utente puo\' risolvere', () => {
  it('la lingua originale: 422 SAME_LANGUAGE', async () => {
    const res = await traduci('it');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SAME_LANGUAGE');
  });

  it('senza trascrizione: 422 SOURCE_TRANSCRIPT_MISSING', async () => {
    const res = await traduci('en');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SOURCE_TRANSCRIPT_MISSING');
  });

  it('una trascrizione dai sottotitoli live, senza file: 422 CAPTIONS_TRANSCRIPT_NOT_TRANSLATABLE', async () => {
    m.trascrizione.mockResolvedValue({ id: 't', blobKey: '' });
    const res = await traduci('en');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('CAPTIONS_TRANSCRIPT_NOT_TRANSLATABLE');
  });

  it('una trascrizione AI con il suo file si traduce', async () => {
    m.trascrizione.mockResolvedValue({ id: 't', blobKey: 'postprod/e/r/001/transcript.raw.json' });
    const res = await traduci('en');
    expect(res.status).toBe(200);
  });
});
