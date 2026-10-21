// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ sito: vi.fn(), registrazione: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: () => undefined })) }));
vi.mock('@/lib/auth/staff-session', () => ({ requireRecordingManager: vi.fn(async () => ({ role: 'admin' })) }));
vi.mock('@/lib/audit/admin-audit', () => ({ logAdminAction: vi.fn() }));
vi.mock('@/lib/ai/enqueue', () => ({ enqueueArchiveJob: vi.fn(async () => ({ enqueued: true, jobId: 'j1' })) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    siteSetting: { findUnique: m.sito },
    recording: { findUnique: m.registrazione },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  },
}));

import { POST } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const archivia = () =>
  POST(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/archive`, { method: 'POST' }) as never,
    { params: Promise.resolve({ id: ID }) } as never,
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.sito.mockResolvedValue({ aiPipelineEnabled: true });
  m.registrazione.mockResolvedValue({ id: ID, blobKey: 'recordings/ev/mix.mp4', _count: { tracks: 0 } });
});

describe('POST archive: i codici delle condizioni che l\'utente puo\' risolvere', () => {
  it('pipeline spenta: 422 AI_PIPELINE_DISABLED', async () => {
    m.sito.mockResolvedValueOnce({ aiPipelineEnabled: false });
    const res = await archivia();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('AI_PIPELINE_DISABLED');
  });

  it('nessuna traccia per partecipante: 422 NO_PARTICIPANT_TRACKS', async () => {
    const res = await archivia();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('NO_PARTICIPANT_TRACKS');
  });

  it('tracce senza il video della sala: 422 RECORDING_WITHOUT_VIDEO, nessun lavoro in coda', async () => {
    const { enqueueArchiveJob } = await import('@/lib/ai/enqueue');
    m.registrazione.mockResolvedValueOnce({ id: ID, blobKey: `recordings/multitrack/${ID}/`, _count: { tracks: 2 } });
    const res = await archivia();
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('RECORDING_WITHOUT_VIDEO');
    expect(enqueueArchiveJob).not.toHaveBeenCalled();
  });

  it('tracce e video della sala: il lavoro va in coda', async () => {
    const { enqueueArchiveJob } = await import('@/lib/ai/enqueue');
    m.registrazione.mockResolvedValueOnce({ id: ID, blobKey: 'recordings/ev/mix.mp4', _count: { tracks: 2 } });
    const res = await archivia();
    expect(res.status).toBe(200);
    expect(enqueueArchiveJob).toHaveBeenCalledWith({}, { recordingId: ID });
  });
});
