// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sito: vi.fn(),
  registrazione: vi.fn(),
  corretta: vi.fn(),
  soloSottotitoli: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireRecordingManager: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/ai/enqueue', () => ({ enqueuePostprodForRecording: vi.fn() }));
vi.mock('@/lib/captions/transcript', () => ({
  trascrizioneCorrettaDaiSottotitoli: m.corretta,
  registrazioneSoloSottotitoli: m.soloSottotitoli,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: m.sito },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ recording: { findUnique: m.registrazione }, event: { update: vi.fn() } }),
    ),
  },
}));

import { POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const genera = () =>
  POST(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/generate-ai`, {
      method: 'POST',
      body: JSON.stringify({ summary: true }),
    }) as never,
    { params: Promise.resolve({ id: ID }) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.sito.mockResolvedValue({ aiPipelineEnabled: true });
  m.registrazione.mockResolvedValue({ id: ID, eventId: 'e', blobKey: 'k' });
  m.corretta.mockResolvedValue(false);
  m.soloSottotitoli.mockReturnValue(false);
});

// I codici sono il contratto con le schermate, che li traducono
// (lib/api-error-message): lo stato da solo non dice cosa fare.
describe('POST generate-ai: i codici delle condizioni che l\'utente puo\' risolvere', () => {
  it('pipeline spenta: 422 AI_PIPELINE_DISABLED', async () => {
    m.sito.mockResolvedValueOnce({ aiPipelineEnabled: false });
    const res = await genera();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('AI_PIPELINE_DISABLED');
  });

  it('trascrizione dei sottotitoli corretta a mano: 409 TRANSCRIPT_CORRECTED', async () => {
    m.corretta.mockResolvedValueOnce(true);
    const res = await genera();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('TRANSCRIPT_CORRECTED');
  });

  it('registrazione senza video: 422 RECORDING_WITHOUT_MEDIA', async () => {
    m.soloSottotitoli.mockReturnValueOnce(true);
    const res = await genera();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('RECORDING_WITHOUT_MEDIA');
  });
});
