/**
 * SPDX SBOM → compact summary for the changelog SBOM viewer.
 *
 * The raw `sbom.spdx.json` on a GitHub release is ~640 KB (syft, SPDX-2.3): far
 * too large to ship to the browser. This reduces it to a searchable component
 * inventory — name, version, ecosystem — plus per-ecosystem counts. The
 * ecosystem is read from each package's purl (`pkg:npm/…`, `pkg:apk/…`), which
 * every syft package carries; licenses are deliberately dropped because syft on
 * a container image reports them all as NOASSERTION (useless to display).
 *
 * Pure and defensive: it never throws on a malformed document, so the route can
 * feed it whatever GitHub returned and still answer.
 */

export interface SbomComponent {
  name: string;
  version: string;
  /** npm, apk, gem, pypi, golang, … derived from the purl; 'other' if absent. */
  ecosystem: string;
}

export interface SbomSummary {
  /** The subject of the SBOM — for us the container image name. */
  image: string;
  /** Tool that produced it (e.g. "syft-1.42.3"), best-effort. */
  tool: string;
  /** ISO timestamp from the SPDX creationInfo, or '' if absent. */
  createdAt: string;
  /** Number of components after dropping the image's own root package. */
  total: number;
  /** Component count per ecosystem, most first is the caller's concern. */
  byEcosystem: Record<string, number>;
  components: SbomComponent[];
}

interface SpdxExternalRef {
  referenceType?: string;
  referenceLocator?: string;
}
interface SpdxPackage {
  name?: string;
  versionInfo?: string;
  SPDXID?: string;
  externalRefs?: SpdxExternalRef[];
}
interface SpdxDoc {
  name?: string;
  creationInfo?: { created?: string; creators?: string[] };
  packages?: SpdxPackage[];
}

function ecosystemOf(pkg: SpdxPackage): string {
  // Guard each element: a malformed SBOM can carry null/non-object entries, and
  // the contract is that this never throws (the route degrades to 502, not 500).
  const refs = Array.isArray(pkg.externalRefs) ? pkg.externalRefs : [];
  const purl = refs.find((r) => r && r.referenceType === 'purl')?.referenceLocator;
  const fromPurl = typeof purl === 'string' ? purl.match(/^pkg:([^/]+)\//)?.[1] : undefined;
  if (fromPurl) return fromPurl.toLowerCase();
  // Fallback: syft encodes the type in the SPDXID (SPDXRef-Package-npm-…).
  const fromId = pkg.SPDXID?.match(/^SPDXRef-Package-([a-z]+)/i)?.[1];
  return fromId ? fromId.toLowerCase() : 'other';
}

export function summarizeSpdx(input: unknown): SbomSummary {
  const doc = (input ?? {}) as SpdxDoc;
  const image = typeof doc.name === 'string' ? doc.name : '';
  const creators = Array.isArray(doc.creationInfo?.creators) ? doc.creationInfo!.creators! : [];
  const tool = (
    creators.find((c) => typeof c === 'string' && c.startsWith('Tool:')) ?? ''
  ).replace(/^Tool:\s*/, '');
  const createdAt = typeof doc.creationInfo?.created === 'string' ? doc.creationInfo.created : '';

  const packages = Array.isArray(doc.packages) ? doc.packages : [];
  const components: SbomComponent[] = [];
  for (const pkg of packages) {
    const name = typeof pkg?.name === 'string' ? pkg.name.trim() : '';
    if (!name) continue;
    const ecosystem = ecosystemOf(pkg);
    // Drop the SBOM's own subject (the image itself, ecosystem 'oci'): it is the
    // container, not one of its dependencies.
    if (ecosystem === 'oci' && image && name === image) continue;
    components.push({
      name,
      version: typeof pkg.versionInfo === 'string' ? pkg.versionInfo : '',
      ecosystem,
    });
  }

  components.sort(
    (a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name),
  );

  const byEcosystem: Record<string, number> = {};
  for (const c of components) byEcosystem[c.ecosystem] = (byEcosystem[c.ecosystem] ?? 0) + 1;

  return { image, tool, createdAt, total: components.length, byEcosystem, components };
}
