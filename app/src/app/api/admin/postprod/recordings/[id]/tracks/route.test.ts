// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ registrazione: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireRecordingManager: vi.fn(async () => ({ role: 'admin' })),
}));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (v: string) => v }));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  presignArtifactDownload: vi.fn(
    async ({ blobKey }: { blobKey: string }) => `https://storage/${blobKey}?sig`
  ),
}));
vi.mock('@/lib/db', () => ({ prisma: { recording: { findUnique: m.registrazione } } }));

import { GET } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const tracce = () =>
  GET(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/tracks`) as never,
    {
      params: Promise.resolve({ id: ID }),
    } as never
  );

const registrazione = (blobKey: string) => ({
  id: ID,
  blobKey,
  sourceLanguage: 'it',
  tracks: [
    {
      id: 't1',
      participantId: 'p1',
      displayName: 'Anna',
      blobKey: 'a/t1.opus',
      startOffsetMs: 1500,
    },
  ],
  artifacts: [],
  jobs: [],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET tracks: il mix si offre solo se c'è il video della sala", () => {
  it('con il video: mixUrl verso la rotta del media', async () => {
    m.registrazione.mockResolvedValueOnce(registrazione('recordings/ev/mix.mp4'));
    const body = await (await tracce()).json();
    expect(body.mixUrl).toBe(`/api/admin/postprod/recordings/${ID}/media`);
    expect(body.tracks).toEqual([
      expect.objectContaining({
        id: 't1',
        displayName: 'Anna',
        offsetSec: 1.5,
        audioUrl: 'https://storage/a/t1.opus?sig',
      }),
    ]);
  });

  it('solo tracce (segnaposto multitraccia): mixUrl null, le tracce restano', async () => {
    m.registrazione.mockResolvedValueOnce(registrazione(`recordings/multitrack/${ID}/`));
    const body = await (await tracce()).json();
    expect(body.mixUrl).toBeNull();
    expect(body.tracks).toHaveLength(1);
  });

  it('solo sottotitoli: mixUrl null', async () => {
    m.registrazione.mockResolvedValueOnce({ ...registrazione(''), tracks: [] });
    const body = await (await tracce()).json();
    expect(body.mixUrl).toBeNull();
  });
});
