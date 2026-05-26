import { describe, it, expect } from 'vitest';

import { constantTimeEqual } from './moderator';

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });

  it('returns false for strings of the same length that differ', () => {
    expect(constantTimeEqual('abcd', 'abce')).toBe(false);
  });

  it('returns true for two empty strings', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('handles multi-byte unicode safely', () => {
    expect(constantTimeEqual('café', 'café')).toBe(true);
    expect(constantTimeEqual('café', 'cafe')).toBe(false);
  });
});
