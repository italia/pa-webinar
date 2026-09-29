import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { RELEASES } from './entries';

/**
 * publiccode.yml e' cio' che il catalogo Developers Italia legge: se dichiara
 * una versione vecchia, il catalogo mostra un software fermo a quella. Deve
 * dire la stessa versione di package.json, con la data di quel rilascio nel
 * changelog.
 */
const ROOT = path.resolve(__dirname, '../../../..');

function field(yaml: string, name: string): string | undefined {
  return yaml.match(new RegExp(`^${name}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'))?.[1];
}

describe('publiccode.yml', () => {
  const yaml = fs.readFileSync(path.join(ROOT, 'publiccode.yml'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };

  it('declares the version of package.json', () => {
    expect(field(yaml, 'softwareVersion')).toBe(pkg.version);
  });

  it('declares the release date of that version in the changelog', () => {
    const release = RELEASES.find((r) => r.version === pkg.version);
    expect(release, `no changelog entry for ${pkg.version}`).toBeDefined();
    expect(field(yaml, 'releaseDate')).toBe(release!.date);
  });
});
