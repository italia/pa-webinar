/**
 * Public changelog, localized.
 *
 * Until 0.8.3 the release notes existed only in Italian, hard-coded in a single
 * TypeScript file — so an English (or Greek, or Polish) visitor of a site that
 * ships 24 languages read Italian. The text now lives in per-locale JSON next
 * to this file, and the release spine (`entries.ts`) carries only version, date
 * and the security flag.
 *
 * Resolution order for each release: requested locale → English → Italian. The
 * last step matters because English is generated from the Italian original, so
 * a release added to `it.json` alone still appears (in Italian) rather than
 * silently vanishing from the page.
 *
 * The whole catalogue is imported statically: this is consumed by a Server
 * Component only (`/[locale]/changelog`), so all 24 files stay server-side and
 * never reach the browser bundle. Do NOT import this from a client component.
 */

import { RELEASES, type Release } from './entries';
import bg from './translations/bg.json';
import cs from './translations/cs.json';
import da from './translations/da.json';
import de from './translations/de.json';
import el from './translations/el.json';
import en from './translations/en.json';
import es from './translations/es.json';
import et from './translations/et.json';
import fi from './translations/fi.json';
import fr from './translations/fr.json';
import ga from './translations/ga.json';
import hr from './translations/hr.json';
import hu from './translations/hu.json';
import it from './translations/it.json';
import lt from './translations/lt.json';
import lv from './translations/lv.json';
import mt from './translations/mt.json';
import nl from './translations/nl.json';
import pl from './translations/pl.json';
import pt from './translations/pt.json';
import ro from './translations/ro.json';
import sk from './translations/sk.json';
import sl from './translations/sl.json';
import sv from './translations/sv.json';

export type { Release } from './entries';

/** Text of one release in one language. */
export interface ReleaseText {
  /** Short theme for the release. */
  title: string;
  /** User-facing highlights, most notable first. */
  notes: string[];
}

/** A release plus the text resolved for the requested locale. */
export interface ChangelogEntry extends Release, ReleaseText {
  /**
   * Locale the text actually came from. Differs from the requested one when a
   * release has not been translated yet — the page can surface that honestly
   * instead of pretending the note is in the reader's language.
   */
  textLocale: string;
}

type Catalogue = Record<string, ReleaseText | undefined>;

const TRANSLATIONS: Record<string, Catalogue> = {
  bg, cs, da, de, el, en, es, et, fi, fr, ga, hr, hu, it,
  lt, lv, mt, nl, pl, pt, ro, sk, sl, sv,
};

/** Locales tried, in order, when the requested one has no text for a release. */
const FALLBACK_CHAIN = ['en', 'it'];

/**
 * Releases (newest first) with title and notes in `locale` where available.
 * A release with no text in ANY locale is dropped rather than rendered blank —
 * that can only mean a version was added to the spine and the copy forgotten.
 */
export function getChangelog(locale: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];

  for (const release of RELEASES) {
    for (const candidate of [locale, ...FALLBACK_CHAIN]) {
      const text = TRANSLATIONS[candidate]?.[release.version];
      if (text) {
        entries.push({ ...release, ...text, textLocale: candidate });
        break;
      }
    }
  }

  return entries;
}

/** Locales that ship a changelog catalogue. Exported for the parity test. */
export const CHANGELOG_LOCALES = Object.keys(TRANSLATIONS);
