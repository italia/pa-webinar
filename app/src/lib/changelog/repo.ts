/**
 * Normalize the admin-set `githubUrl` to a trusted github.com repo base, or
 * null. Shared by the changelog page (which builds release/source/Scorecard
 * links) and the SBOM route (which fetches a release asset) so both apply the
 * SAME host guard: the admin settings validator only checks the value is a URL,
 * so without this a non-GitHub URL would yield broken links and a mis-built
 * Scorecard href — and, for the route, an SSRF target.
 */
export function githubRepoUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
  // Require owner/repo: a bare github.com or an owner-only URL would produce a
  // malformed Scorecard href and /releases/... links that 404. Normalize to
  // exactly the two-segment base, dropping any deeper path.
  const [owner, repo] = url.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return `https://github.com/${owner}/${repo}`;
}
