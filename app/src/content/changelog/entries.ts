/**
 * Release spine — version, date and the security/sbom flags. No prose at all:
 * the user-facing text lives per-locale in `translations/<locale>.json`, and
 * the technical detail is now a panel of artifact links (SBOM/release/sources/
 * pipeline) rendered from these flags, not hand-written prose that repeated it.
 *
 * The data lives in `releases.json` rather than inline here so the CHANGELOG.md
 * generator (`npm run changelog:md`) can read it without parsing TypeScript.
 * The public changelog reads in every language the site ships instead of Italian
 * only, as it did up to 0.8.3. English is the reference locale: CHANGELOG.md at
 * the repo root is generated from it, and any locale missing an entry falls back
 * to it.
 *
 * Cutting a release: add the version to `releases.json` (newest first) and its
 * text to `translations/en.json` and `translations/it.json` (the note count
 * must match across every locale — a test enforces it), then run
 * `npm run changelog:md` to regenerate CHANGELOG.md. If the release ships an
 * SBOM (every release since the CI fix does), set `sbom: true` so the SBOM
 * viewer and raw-download appear on the card — but verify the Release is
 * actually published before relying on it.
 */

import releases from './releases.json';

export interface Release {
  /** Semantic version without the leading "v" (matches NEXT_PUBLIC_BUILD_VERSION). */
  version: string;
  /** ISO date (YYYY-MM-DD) of the release tag. */
  date: string;
  /** Marks a release whose primary purpose was security/dependency hardening. */
  security?: boolean;
  /**
   * True when this version has a public GitHub Release carrying an
   * `sbom.spdx.json` asset. Gates the card's SBOM viewer + raw download: many
   * versions are only git tags (no formal Release, no SBOM), so offering an SBOM
   * there would 404 or promise one that isn't attached. For the version being
   * cut, the release workflow attaches the SBOM on tag push, so set it as part
   * of cutting the release — but verify the Release is actually published first
   * (a failed CI run would leave the flag ahead of reality). The route that
   * serves the parsed SBOM also gates on this flag, so it never fetches for a
   * version we didn't ship one for.
   */
  sbom?: boolean;
}

/** Newest first. `translations/<locale>.json` is keyed by `version`. */
export const RELEASES: Release[] = releases;
