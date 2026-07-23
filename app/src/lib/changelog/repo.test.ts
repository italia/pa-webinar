import { describe, it, expect } from 'vitest';

import { githubRepoUrl } from './repo';

describe('githubRepoUrl', () => {
  it('normalizes a valid github repo URL to owner/repo', () => {
    expect(githubRepoUrl('https://github.com/italia/pa-webinar')).toBe(
      'https://github.com/italia/pa-webinar',
    );
    expect(githubRepoUrl('https://github.com/italia/pa-webinar/')).toBe(
      'https://github.com/italia/pa-webinar',
    );
    // Deeper paths are trimmed back to the repo base.
    expect(githubRepoUrl('https://github.com/italia/pa-webinar/tree/main')).toBe(
      'https://github.com/italia/pa-webinar',
    );
  });

  it('rejects a bare host or owner-only URL (no repo → broken links)', () => {
    expect(githubRepoUrl('https://github.com')).toBeNull();
    expect(githubRepoUrl('https://github.com/')).toBeNull();
    expect(githubRepoUrl('https://github.com/italia')).toBeNull();
  });

  it('rejects non-github hosts and non-https schemes', () => {
    expect(githubRepoUrl('https://gitlab.com/italia/pa-webinar')).toBeNull();
    expect(githubRepoUrl('https://github.acme.it/italia/pa-webinar')).toBeNull();
    expect(githubRepoUrl('http://github.com/italia/pa-webinar')).toBeNull();
    // A look-alike host must not slip through.
    expect(githubRepoUrl('https://github.com.evil.com/italia/pa-webinar')).toBeNull();
  });

  it('rejects non-strings and non-URLs', () => {
    expect(githubRepoUrl(null)).toBeNull();
    expect(githubRepoUrl(undefined)).toBeNull();
    expect(githubRepoUrl('')).toBeNull();
    expect(githubRepoUrl('not a url')).toBeNull();
    expect(githubRepoUrl(42)).toBeNull();
  });
});
