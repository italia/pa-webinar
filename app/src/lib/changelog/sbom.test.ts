import { describe, it, expect } from 'vitest';

import { summarizeSpdx } from './sbom';

const doc = {
  name: 'ghcr.io/italia/pa-webinar',
  creationInfo: {
    created: '2026-07-23T12:42:33Z',
    creators: ['Organization: Anchore, Inc', 'Tool: syft-1.42.3'],
  },
  packages: [
    {
      name: 'next',
      versionInfo: '15.4.1',
      SPDXID: 'SPDXRef-Package-npm-next-abc',
      externalRefs: [
        { referenceType: 'purl', referenceLocator: 'pkg:npm/next@15.4.1' },
      ],
    },
    {
      name: '@asamuzakjp/dom-selector',
      versionInfo: '7.1.1',
      SPDXID: 'SPDXRef-Package-npm--asamuzakjp-dom-selector-xyz',
      externalRefs: [
        { referenceType: 'purl', referenceLocator: 'pkg:npm/%40asamuzakjp/dom-selector@7.1.1' },
      ],
    },
    {
      name: 'musl',
      versionInfo: '1.2.5',
      SPDXID: 'SPDXRef-Package-apk-musl-1',
      externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:apk/alpine/musl@1.2.5' }],
    },
    {
      // The image's own root package — must be dropped from the inventory.
      name: 'ghcr.io/italia/pa-webinar',
      SPDXID: 'SPDXRef-Package-oci-image',
      externalRefs: [{ referenceType: 'purl', referenceLocator: 'pkg:oci/pa-webinar@sha256%3Aabc' }],
    },
  ],
};

describe('summarizeSpdx', () => {
  it('reads image, tool and creation date', () => {
    const s = summarizeSpdx(doc);
    expect(s.image).toBe('ghcr.io/italia/pa-webinar');
    expect(s.tool).toBe('syft-1.42.3');
    expect(s.createdAt).toBe('2026-07-23T12:42:33Z');
  });

  it('drops the image root and counts real components by ecosystem', () => {
    const s = summarizeSpdx(doc);
    expect(s.total).toBe(3); // next, dom-selector, musl — not the oci image
    expect(s.byEcosystem).toEqual({ npm: 2, apk: 1 });
    expect(s.components.some((c) => c.ecosystem === 'oci')).toBe(false);
  });

  it('derives ecosystem from the purl and keeps scoped names', () => {
    const s = summarizeSpdx(doc);
    const scoped = s.components.find((c) => c.name === '@asamuzakjp/dom-selector');
    expect(scoped).toEqual({ name: '@asamuzakjp/dom-selector', version: '7.1.1', ecosystem: 'npm' });
  });

  it('sorts by ecosystem then name', () => {
    const s = summarizeSpdx(doc);
    expect(s.components.map((c) => `${c.ecosystem}:${c.name}`)).toEqual([
      'apk:musl',
      'npm:@asamuzakjp/dom-selector',
      'npm:next',
    ]);
  });

  it('falls back to the SPDXID when a package has no purl', () => {
    const s = summarizeSpdx({
      packages: [{ name: 'foo', versionInfo: '1.0', SPDXID: 'SPDXRef-Package-gem-foo' }],
    });
    expect(s.components[0]).toEqual({ name: 'foo', version: '1.0', ecosystem: 'gem' });
  });

  it('never throws on a malformed document', () => {
    expect(() => summarizeSpdx(null)).not.toThrow();
    expect(() => summarizeSpdx({})).not.toThrow();
    expect(() => summarizeSpdx({ packages: 'nope' })).not.toThrow();
    expect(summarizeSpdx(null).total).toBe(0);
    expect(summarizeSpdx({ packages: [{ versionInfo: '1' }] }).total).toBe(0); // no name → skipped
  });

  it('never throws on non-string creators or null externalRefs entries', () => {
    const s = summarizeSpdx({
      creationInfo: { creators: [123, { x: 1 }, 'Tool: syft-1.0'] },
      packages: [
        { name: 'a', versionInfo: '1', externalRefs: [null, { referenceType: 'purl', referenceLocator: 'pkg:npm/a@1' }] },
        { name: 'b', versionInfo: '2', externalRefs: null },
      ],
    });
    expect(s.tool).toBe('syft-1.0'); // skipped the non-string creators
    expect(s.components.find((c) => c.name === 'a')?.ecosystem).toBe('npm');
    expect(s.components.find((c) => c.name === 'b')?.ecosystem).toBe('other');
  });
});
