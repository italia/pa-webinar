#!/usr/bin/env node
/**
 * Regenerate CHANGELOG.md (English) from the site's changelog data.
 *
 * The repository's changelog is the ENGLISH one — this is an open-source
 * project on GitHub, read by people who do not speak Italian — while the site
 * renders the same releases in each of its 24 locales. Both come from the same
 * source so they cannot drift: `releases.json` (version/date/security) plus
 * `translations/en.json` (title + notes).
 *
 * Usage: npm run changelog:md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const dataDir = join(repoRoot, 'app/src/content/changelog');

const releases = JSON.parse(readFileSync(join(dataDir, 'releases.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(dataDir, 'translations/en.json'), 'utf8'));

const missing = releases.filter((r) => !en[r.version]).map((r) => r.version);
if (missing.length > 0) {
  console.error(
    `Missing English text for: ${missing.join(', ')}.\n` +
      'Add it to app/src/content/changelog/translations/en.json before regenerating.',
  );
  process.exit(1);
}

const lines = [
  '# Changelog',
  '',
  'All notable changes to PA Webinar, newest first.',
  '',
  'This file is **generated** — run `npm run changelog:md` after editing',
  '`app/src/content/changelog/releases.json` or',
  '`app/src/content/changelog/translations/en.json`. The same data renders the',
  'public `/changelog` page, translated into every language the site ships.',
  '',
  'Versions follow [semantic versioning](https://semver.org/). Releases marked',
  '🔒 were primarily security or dependency hardening.',
  '',
];

for (const release of releases) {
  const text = en[release.version];
  const flag = release.security ? ' 🔒' : '';
  lines.push(`## ${release.version} — ${release.date}${flag}`);
  lines.push('');
  lines.push(`**${text.title}**`);
  lines.push('');
  for (const note of text.notes) lines.push(`- ${note}`);
  lines.push('');
}

writeFileSync(join(repoRoot, 'CHANGELOG.md'), lines.join('\n'));
console.log(`CHANGELOG.md: ${releases.length} releases written`);
