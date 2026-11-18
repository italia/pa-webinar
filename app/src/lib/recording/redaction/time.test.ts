// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { formatTempo, leggiTempo } from './time';

describe('i tempi dell’editor', () => {
  it('si scrivono come nel player', () => {
    expect(formatTempo(0)).toBe('0:00.0');
    expect(formatTempo(75.25)).toBe('1:15.3');
    expect(formatTempo(3725)).toBe('1:02:05.0');
    expect(formatTempo(-3)).toBe('0:00.0');
  });

  it('si leggono in piu’ forme, e un tempo sbagliato non passa', () => {
    expect(leggiTempo('1:15.3')).toBe(75.3);
    expect(leggiTempo(' 90 ')).toBe(90);
    expect(leggiTempo('1:02:05')).toBe(3725);
    expect(leggiTempo('0,5')).toBe(0.5);
    expect(leggiTempo('1:75')).toBeNull();
    expect(leggiTempo('abc')).toBeNull();
    expect(leggiTempo('')).toBeNull();
    expect(leggiTempo(formatTempo(4321.7))).toBe(4321.7);
  });
});
