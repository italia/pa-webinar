// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { parseAvatarSize } from './avatar';

describe('parseAvatarSize', () => {
  it('senza parametro usa il default, non il minimo', () => {
    // La regressione da cui nasce questo test: `Number('')` è 0, che è finito,
    // quindi `?name=Mario` (la forma documentata) veniva servita a 32px.
    expect(parseAvatarSize(null)).toBe(200);
    expect(parseAvatarSize('')).toBe(200);
  });

  it('rispetta una dimensione valida', () => {
    expect(parseAvatarSize('128')).toBe(128);
  });

  it('limita agli estremi invece di rifiutare', () => {
    expect(parseAvatarSize('8')).toBe(32);
    expect(parseAvatarSize('4096')).toBe(512);
  });

  it('un valore non numerico non diventa NaN nelle coordinate SVG', () => {
    expect(parseAvatarSize('abc')).toBe(200);
    expect(parseAvatarSize('Infinity')).toBe(200);
  });
});
