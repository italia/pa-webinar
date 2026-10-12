// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { generateAvatarSvg, parseAvatarSize } from './avatar';

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

describe('generateAvatarSvg', () => {
  it.each(['<x', '& Co', '"Ente" Locale', "'Ufficio"])('il nome %j da\' un SVG con le iniziali come testo', (nome) => {
    const svg = generateAvatarSvg(nome, 64);
    const testo = /<text[^>]*>([^<]*)<\/text>/.exec(svg)?.[1] ?? null;
    // Nessun carattere che spezzi il markup dentro il testo.
    expect(testo).not.toBeNull();
    expect(testo).not.toMatch(/[<>"']|&(?!amp;|lt;|gt;|quot;|apos;)/);
  });
});
