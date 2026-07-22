import { describe, it, expect } from 'vitest';

import { gravatarUrl } from './avatar-gravatar';

describe('gravatarUrl', () => {
  it('normalises the address before hashing (Gravatar is case/space insensitive)', () => {
    const a = gravatarUrl('Mario.Rossi@Example.IT');
    const b = gravatarUrl('  mario.rossi@example.it ');
    expect(a).toBe(b);
    expect(a).toMatch(/^https:\/\/www\.gravatar\.com\/avatar\/[a-f0-9]{64}\?/);
  });

  it('uses SHA-256, not the legacy MD5', () => {
    const hash = gravatarUrl('a@b.it')!.match(/avatar\/([a-f0-9]+)/)![1]!;
    expect(hash).toHaveLength(64);
  });

  it('asks for a deterministic fallback picture rather than a broken image', () => {
    // Gravatar cannot fall back to the initials avatar we generate ourselves, so
    // an address with no picture must still render something.
    expect(gravatarUrl('a@b.it')).toContain('d=identicon');
  });

  it('returns null for anything that is not an address', () => {
    for (const bad of [undefined, '', '   ', 'mario', 'mario.rossi']) {
      expect(gravatarUrl(bad as string | undefined), String(bad)).toBeNull();
    }
  });

  it('honours the requested size', () => {
    expect(gravatarUrl('a@b.it', 64)).toContain('s=64');
  });
});
