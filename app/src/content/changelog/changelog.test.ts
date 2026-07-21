import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import { RELEASES } from './entries';
import { getChangelog, CHANGELOG_LOCALES } from './index';

/**
 * The public changelog used to exist only in Italian, on a site that ships 24
 * languages: an English or Greek visitor read Italian release notes. These
 * guards keep the catalogue whole — every locale, every release — and keep the
 * repository's CHANGELOG.md in sync with what the site renders.
 */

const TRANSLATIONS_DIR = path.resolve(__dirname, 'translations');
const MESSAGES_DIR = path.resolve(__dirname, '../../i18n/messages');
const CHANGELOG_MD = path.resolve(__dirname, '../../../../CHANGELOG.md');

function loadCatalogue(locale: string): Record<string, { title: string; notes: string[] }> {
  return JSON.parse(
    fs.readFileSync(path.join(TRANSLATIONS_DIR, `${locale}.json`), 'utf-8'),
  );
}

describe('changelog catalogue', () => {
  it('covers every locale the site ships', () => {
    const siteLocales = fs
      .readdirSync(MESSAGES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''))
      .sort();
    expect(CHANGELOG_LOCALES.slice().sort()).toEqual(siteLocales);
  });

  it('has at least one release and no duplicate versions', () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('lists releases newest first', () => {
    const dates = RELEASES.map((r) => r.date);
    const sorted = dates.slice().sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it('uses ISO dates', () => {
    for (const r of RELEASES) {
      expect(r.date, r.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(new Date(r.date).getTime()), r.version).toBe(false);
    }
  });

  for (const locale of CHANGELOG_LOCALES) {
    it(`${locale}: every release has a non-empty title and notes`, () => {
      const catalogue = loadCatalogue(locale);
      for (const release of RELEASES) {
        const text = catalogue[release.version];
        expect(text, `${locale} is missing ${release.version}`).toBeDefined();
        if (!text) continue;
        expect(text.title.trim().length, `${locale} ${release.version} title`).toBeGreaterThan(0);
        expect(text.notes.length, `${locale} ${release.version} notes`).toBeGreaterThan(0);
        for (const note of text.notes) {
          expect(note.trim().length, `${locale} ${release.version} empty note`).toBeGreaterThan(0);
        }
      }
    });

    it(`${locale}: has the same note count per release as the Italian original`, () => {
      // A translator dropping or merging bullets would silently lose content.
      const it = loadCatalogue('it');
      const catalogue = loadCatalogue(locale);
      for (const release of RELEASES) {
        expect(
          catalogue[release.version]?.notes.length,
          `${locale} ${release.version}`,
        ).toBe(it[release.version]?.notes.length);
      }
    });
  }
});

describe('getChangelog', () => {
  it('returns every release for a shipped locale', () => {
    expect(getChangelog('en').map((e) => e.version)).toEqual(RELEASES.map((r) => r.version));
    expect(getChangelog('it')).toHaveLength(RELEASES.length);
  });

  it('falls back to English for an unknown locale, and says so', () => {
    const entries = getChangelog('xx-unknown');
    expect(entries).toHaveLength(RELEASES.length);
    expect(entries.every((e) => e.textLocale === 'en')).toBe(true);
  });

  it('reports the requested locale when it has its own text', () => {
    expect(getChangelog('de').every((e) => e.textLocale === 'de')).toBe(true);
  });

  it('carries the release metadata through', () => {
    const first = getChangelog('en')[0];
    expect(first?.version).toBe(RELEASES[0]?.version);
    expect(first?.date).toBe(RELEASES[0]?.date);
  });
});

describe('CHANGELOG.md', () => {
  it('is in sync with the release data (run `npm run changelog:md`)', () => {
    const md = fs.readFileSync(CHANGELOG_MD, 'utf-8');
    for (const release of RELEASES) {
      expect(md, `CHANGELOG.md is missing ${release.version}`).toContain(
        `## ${release.version} — ${release.date}`,
      );
    }
  });

  it('is the ENGLISH changelog (the repository language), not the Italian one', () => {
    const md = fs.readFileSync(CHANGELOG_MD, 'utf-8');
    const en = loadCatalogue('en');
    const newest = RELEASES[0]?.version ?? '';
    expect(md).toContain(en[newest]?.title ?? '###missing###');
  });
});
