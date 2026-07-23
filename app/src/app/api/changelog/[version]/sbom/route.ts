/**
 * GET /api/changelog/:version/sbom
 *
 * Server-side proxy + parser for a release's SPDX SBOM, feeding the changelog
 * SBOM viewer modal. Doing this on the server (not the browser) avoids CORS on
 * the GitHub release asset, keeps the 640 KB document off the client (only a
 * trimmed inventory crosses the wire), and lets us cache — a released version's
 * SBOM is immutable.
 *
 * SSRF is the risk to watch: the URL is built from the request path, so we only
 * ever fetch for a `version` that exists in our own release spine AND is flagged
 * `sbom: true`, and the host comes from the admin-set `githubUrl` — never from
 * anything the caller supplied beyond the whitelisted version string.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { withErrorHandling } from '@/lib/api-handler';
import { RELEASES } from '@/content/changelog/entries';
import { getSettings } from '@/lib/settings';
import { githubRepoUrl } from '@/lib/changelog/repo';
import { summarizeSpdx, type SbomSummary } from '@/lib/changelog/sbom';

// A released version's SBOM never changes, so cache the trimmed summary for the
// process lifetime. Bounded by the number of releases (tens), no eviction needed.
const cache = new Map<string, SbomSummary>();

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=86400, immutable' };

export const GET = withErrorHandling(async (_request: NextRequest, context) => {
  const { version } = await context.params;

  // Whitelist: the version must be a known release that actually ships an SBOM.
  const release = RELEASES.find((r) => r.version === version);
  if (!release || !release.sbom) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Resolve the repo BEFORE the cache: if the repo is later unlinked, a version
  // cached earlier must stop being served, matching what a fresh process does.
  const settings = await getSettings();
  const repo = githubRepoUrl(settings.githubUrl);
  if (!repo) {
    // Repo not public / no valid github.com URL configured: nothing to link to.
    return NextResponse.json({ error: 'unavailable' }, { status: 404 });
  }

  // Key by repo too: if an admin re-points githubUrl to a different repo, the
  // old repo's cached inventory must not be served for the same version.
  const cacheKey = `${repo}\t${version}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return NextResponse.json(cached, { headers: CACHE_HEADERS });
  }

  const assetUrl = `${repo}/releases/download/v${version}/sbom.spdx.json`;

  let summary: SbomSummary;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(assetUrl, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { Accept: 'application/json' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return NextResponse.json({ error: 'fetch_failed', status: res.status }, { status: 502 });
    }
    summary = summarizeSpdx(await res.json());
  } catch {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 502 });
  }

  // Don't cache a degenerate body (empty {} or wrong schema → 0 components): a
  // partially-uploaded asset during a CI publish would otherwise be pinned as an
  // empty inventory for the process lifetime. Serve it once, let the next open retry.
  if (summary.total === 0) {
    return NextResponse.json({ error: 'empty' }, { status: 502 });
  }

  cache.set(cacheKey, summary);
  return NextResponse.json(summary, { headers: CACHE_HEADERS });
});
