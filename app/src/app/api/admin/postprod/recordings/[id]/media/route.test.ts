// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ registrazione: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));
vi.mock('@/lib/auth/staff-session', () => ({
  requireRecordingManager: vi.fn(async () => ({ role: 'admin' })),
}));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => true,
  presignArtifactDownload: vi.fn(
    async ({ blobKey }: { blobKey: string }) => `https://storage/${blobKey}?sig`
  ),
}));
vi.mock('@/lib/db', () => ({ prisma: { recording: { findUnique: m.registrazione } } }));

import { GET } from './route';

const ID = '11111111-2222-4333-8444-555555555555';
const media = () =>
  GET(
    new Request(`http://x/api/admin/postprod/recordings/${ID}/media`) as never,
    {
      params: Promise.resolve({ id: ID }),
    } as never
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET media', () => {
  it('rimanda al file della sala firmato', async () => {
    m.registrazione.mockResolvedValueOnce({ blobKey: 'recordings/ev/mix.mp4' });
    const res = await media();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://storage/recordings/ev/mix.mp4?sig');
  });

  it('404 senza il video: segnaposto multitraccia o solo sottotitoli', async () => {
    for (const blobKey of [`recordings/multitrack/${ID}/`, '']) {
      m.registrazione.mockResolvedValueOnce({ blobKey });
      expect((await media()).status).toBe(404);
    }
  });
});
