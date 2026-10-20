import { describe, expect, it } from 'vitest';

import { formatVideoTime } from './video-time';

describe('formatVideoTime', () => {
  it('minuti e secondi, e le ore quando servono', () => {
    expect(formatVideoTime(0)).toBe('0:00');
    expect(formatVideoTime(75.9)).toBe('1:15');
    expect(formatVideoTime(3725)).toBe('1:02:05');
  });

  it('un valore negativo o che non è un numero vale zero', () => {
    expect(formatVideoTime(-3)).toBe('0:00');
    expect(formatVideoTime(Number.NaN)).toBe('0:00');
    expect(formatVideoTime(Number.POSITIVE_INFINITY)).toBe('0:00');
  });
});
