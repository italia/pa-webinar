import { describe, it, expect } from 'vitest';

import { splitTitleKicker } from './title-kicker';

describe('splitTitleKicker', () => {
  it('returns plain title when disabled', () => {
    expect(splitTitleKicker('Pausa digitale | Test', false)).toEqual({
      kicker: null,
      main: 'Pausa digitale | Test',
    });
  });

  it('returns plain title when no pipe', () => {
    expect(splitTitleKicker('Pausa digitale speciale', true)).toEqual({
      kicker: null,
      main: 'Pausa digitale speciale',
    });
  });

  it('splits on first pipe and trims both parts', () => {
    expect(splitTitleKicker('Pausa digitale speciale | Prova OSS', true)).toEqual({
      kicker: 'Pausa digitale speciale',
      main: 'Prova OSS',
    });
  });

  it('treats additional pipes as part of the main title', () => {
    expect(splitTitleKicker('A | B | C', true)).toEqual({
      kicker: 'A',
      main: 'B | C',
    });
  });

  it('falls back to plain title when kicker half is empty', () => {
    expect(splitTitleKicker(' | Only main', true)).toEqual({
      kicker: null,
      main: ' | Only main',
    });
  });

  it('falls back to plain title when main half is empty', () => {
    expect(splitTitleKicker('Only kicker | ', true)).toEqual({
      kicker: null,
      main: 'Only kicker | ',
    });
  });
});
