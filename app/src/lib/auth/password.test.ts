// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { hashJoinPassword, verifyJoinPassword } from './password';

/** La password di una chiamata privata: si controlla, e un dato guasto non apre. */
describe('password di una chiamata', () => {
  it('la password giusta passa, una sbagliata no', () => {
    const hash = hashJoinPassword('caffe-delle-nove');
    expect(verifyJoinPassword('caffe-delle-nove', hash)).toBe(true);
    expect(verifyJoinPassword('caffe-delle-dieci', hash)).toBe(false);
  });

  it('nel dato salvato non c’e’ la password, e due hash della stessa differiscono', () => {
    const a = hashJoinPassword('caffe-delle-nove');
    const b = hashJoinPassword('caffe-delle-nove');
    expect(a).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(a).not.toContain('caffe');
    expect(a).not.toBe(b);
  });

  it('una password troppo corta non si salva', () => {
    expect(() => hashJoinPassword('abc')).toThrow(/at least 4/);
    expect(() => hashJoinPassword('')).toThrow();
  });

  it('senza password o senza hash non si entra', () => {
    const hash = hashJoinPassword('caffe-delle-nove');
    expect(verifyJoinPassword('', hash)).toBe(false);
    expect(verifyJoinPassword('caffe-delle-nove', '')).toBe(false);
  });

  it('un hash di formato sconosciuto non si accetta', () => {
    expect(verifyJoinPassword('x', 'bcrypt:ab:cd')).toBe(false);
    expect(verifyJoinPassword('x', 'scrypt:ab')).toBe(false);
    expect(verifyJoinPassword('x', 'scrypt::cd')).toBe(false);
    expect(verifyJoinPassword('x', 'scrypt:ab:')).toBe(false);
  });

  it('un hash guasto non apre con qualunque password', () => {
    // Una chiave che non decodifica e' vuota, e due buffer vuoti sono uguali.
    const sale = '0'.repeat(32);
    expect(verifyJoinPassword('qualunque', `scrypt:${sale}:zz`)).toBe(false);
    expect(verifyJoinPassword('qualunque', `scrypt:zz:${'0'.repeat(128)}`)).toBe(false);
    expect(verifyJoinPassword('qualunque', `scrypt:${sale}:00`)).toBe(false);
  });
});
