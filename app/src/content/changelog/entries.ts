/**
 * Release spine — version, date, the security/sbom flags and language-neutral
 * `technical` prose. No user-facing (translated) prose: that lives in
 * `translations/<locale>.json`.
 *
 * The data lives in `releases.json` rather than inline here so the CHANGELOG.md
 * generator (`npm run changelog:md`) can read it without parsing TypeScript.
 * The user-facing text lives per-locale, so the public changelog reads in every
 * language the site ships instead of Italian only, as it did up to 0.8.3.
 * English is the reference locale: CHANGELOG.md at the repo root is generated
 * from it, and any locale missing an entry falls back to it.
 *
 * Cutting a release: add the version to `releases.json` (newest first) and its
 * text to `translations/en.json` and `translations/it.json` (the note count
 * must match across every locale — a test enforces it), then run
 * `npm run changelog:md` to regenerate CHANGELOG.md. If the release ships an
 * SBOM (every release since the CI fix does), set `sbom: true` so the per-card
 * GitHub link renders — otherwise the SBOM is reachable but unlinked.
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
   * `sbom.spdx.json` asset. Gates the per-card "Release e SBOM su GitHub" link:
   * many versions are only git tags (no formal Release, no SBOM), so linking
   * them would 404 or promise an SBOM that isn't attached. For the version being
   * cut, the release workflow attaches the SBOM on tag push, so set it as part
   * of cutting the release — but verify the Release is actually published before
   * relying on the link (a failed CI run would leave the flag ahead of reality).
   */
  sbom?: boolean;
  /**
   * Developer-facing detail, shown in a collapsible per card. English and
   * language-neutral (it lives here in the spine, NOT in the 24 translation
   * files): the user-facing `notes` are curated for impact and translated;
   * this is the internal work (CI, refactors, reverts) for whoever wants it.
   */
  technical?: string[];
}

/** Newest first. `translations/<locale>.json` is keyed by `version`. */
export const RELEASES: Release[] = releases;
