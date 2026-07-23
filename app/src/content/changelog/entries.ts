/**
 * Release spine — version, date and the security flag, with NO prose.
 *
 * The data lives in `releases.json` rather than inline here so the CHANGELOG.md
 * generator (`npm run changelog:md`) can read it without parsing TypeScript.
 * All user-facing text lives in `translations/<locale>.json`, so the public
 * changelog reads in every language the site ships instead of Italian only, as
 * it did up to 0.8.3. English is the reference locale: CHANGELOG.md at the repo
 * root is generated from it, and any locale missing an entry falls back to it.
 *
 * Cutting a release: add the version to `releases.json` (newest first) and its
 * text to at least `translations/en.json` and `translations/it.json`, then run
 * `npm run changelog:md` to regenerate CHANGELOG.md.
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
   * Developer-facing detail, shown in a collapsible per card. English and
   * language-neutral (it lives here in the spine, NOT in the 24 translation
   * files): the user-facing `notes` are curated for impact and translated;
   * this is the internal work (CI, refactors, reverts) for whoever wants it.
   */
  technical?: string[];
}

/** Newest first. `translations/<locale>.json` is keyed by `version`. */
export const RELEASES: Release[] = releases;
