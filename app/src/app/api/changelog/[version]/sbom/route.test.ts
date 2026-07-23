import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The SBOM proxy builds a github.com URL from the request path, so the property
 * that matters is the SSRF gate: it must fetch ONLY for a version we actually
 * shipped an SBOM for, and only when a valid public repo URL is configured.
 * Everything else (unknown version, un-flagged version, no repo) must 404
 * without any outbound request.
 */
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }));

import { getSettings } from '@/lib/settings';
import { GET } from './route';

const mockedSettings = getSettings as unknown as ReturnType<typeof vi.fn>;

const ctx = (version: string) => ({ params: Promise.resolve({ version }) });
const req = (version: string) =>
  new Request(`https://webinar.gov.it/api/changelog/${version}/sbom`) as never;

const SPDX = {
  name: 'ghcr.io/italia/pa-webinar',
  creationInfo: { created: '2026-07-23T12:42:33Z', creators: ['Tool: syft-1.42.3'] },
  packages: [
    {
      name: 'next',
      versionInfo: '15.4.1',
      externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:npm/next@15.4.1' }],
    },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockedSettings.mockResolvedValue({ githubUrl: 'https://github.com/italia/pa-webinar' });
});

describe('GET /api/changelog/:version/sbom', () => {
  it('404s an unknown version without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req('9.9.9'), ctx('9.9.9'));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s a known version that ships no SBOM, without fetching', async () => {
    // 0.1.0 is in the spine but has no `sbom: true`.
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req('0.1.0'), ctx('0.1.0'));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('404s when no public repo URL is configured, without fetching', async () => {
    mockedSettings.mockResolvedValue({ githubUrl: null });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req('0.8.9'), ctx('0.8.9'));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a non-github host in the configured URL', async () => {
    mockedSettings.mockResolvedValue({ githubUrl: 'https://evil.example.com/x' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req('0.8.9'), ctx('0.8.9'));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the release asset and returns a parsed summary for a shipped SBOM', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(SPDX), { status: 200 }));
    const res = await GET(req('0.8.9'), ctx('0.8.9'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://github.com/italia/pa-webinar/releases/download/v0.8.9/sbom.spdx.json',
      expect.objectContaining({ redirect: 'follow' }),
    );
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.components[0]).toEqual({ name: 'next', version: '15.4.1', ecosystem: 'npm' });
  });

  it('502s when the asset fetch fails', async () => {
    // A different version from the happy path: a summary once fetched is cached
    // for the process (SBOMs are immutable), so reusing 0.8.9 would hit the cache.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    const res = await GET(req('0.8.8'), ctx('0.8.8'));
    expect(res.status).toBe(502);
  });

  it('does not cache a degenerate 200 body, so a later fetch recovers', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 200 })) // 0 components
      .mockResolvedValueOnce(new Response(JSON.stringify(SPDX), { status: 200 }));
    const first = await GET(req('0.8.7'), ctx('0.8.7'));
    expect(first.status).toBe(502); // degenerate → not cached
    const second = await GET(req('0.8.7'), ctx('0.8.7'));
    expect(second.status).toBe(200);
    expect((await second.json()).total).toBe(1);
  });

  it('stops serving a cached SBOM once the repo is unlinked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(SPDX), { status: 200 }),
    );
    const ok = await GET(req('0.7.1'), ctx('0.7.1'));
    expect(ok.status).toBe(200); // now cached
    mockedSettings.mockResolvedValue({ githubUrl: null }); // repo made private again
    const after = await GET(req('0.7.1'), ctx('0.7.1'));
    expect(after.status).toBe(404); // repo guard runs before the cache
  });
});
