import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * I sottotitoli serviti dal portale escono marcati come generati da AI (AI Act
 * art. 50): un blocco NOTE nel file e l'intestazione X-AI-Generated.
 */
vi.mock('@/lib/db', () => ({ prisma: { postprodArtifact: { findFirst: vi.fn() } } }));
vi.mock('@/lib/ai/access', () => ({ assertPostprodAccessible: vi.fn(async () => ({ eventId: 'e1' })) }));
vi.mock('@/lib/crypto/pii', () => ({ tryDecryptPII: (s: string) => s || null }));
vi.mock('@/lib/storage/postprod', () => ({
  isPostprodStorageConfigured: () => false,
  presignArtifactDownload: vi.fn(),
}));

import { prisma } from '@/lib/db';

import { GET } from './route';

const findFirst = (prisma as unknown as { postprodArtifact: { findFirst: ReturnType<typeof vi.fn> } })
  .postprodArtifact.findFirst;
const ctx = { params: Promise.resolve({ param: 'evento', lang: 'it' }) };
const VTT = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nCiao\n';

beforeEach(() => vi.clearAllMocks());

describe('GET subtitle', () => {
  it('marks the served subtitles as AI-generated', async () => {
    findFirst.mockResolvedValue({ id: 'a', blobKey: 'k', inlineBody: VTT, mimeType: 'text/vtt', revisedAt: null, original: null });
    const res = await GET(new Request('https://x.test/s') as never, ctx as never);
    expect(res.headers.get('X-AI-Generated')).toBe('true');
    const body = await res.text();
    expect(body.startsWith('WEBVTT\n\nNOTE\nai-generated: true')).toBe(true);
    expect(body).not.toContain('ai-revision');
    expect(body).toContain('Ciao');
  });

  it('says when a person revised them', async () => {
    findFirst.mockResolvedValue({ id: 'a', blobKey: 'k', inlineBody: VTT, mimeType: 'text/vtt', revisedAt: null, original: { id: 'o' } });
    const body = await (await GET(new Request('https://x.test/s') as never, ctx as never)).text();
    expect(body).toContain('ai-revision:');
  });
});
