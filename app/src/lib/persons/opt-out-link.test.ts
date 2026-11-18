// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rubricaOptOutUrl } from './opt-out-link';
import { verifyRubricaOptOutToken } from './opt-out-token';

const previousSecret = process.env.APP_SECRET;
beforeEach(() => {
  process.env.APP_SECRET = 'segreto-di-prova-lungo-almeno-trentadue-byte';
});
afterEach(() => {
  if (previousSecret === undefined) delete process.env.APP_SECRET;
  else process.env.APP_SECRET = previousSecret;
});

describe('rubricaOptOutUrl', () => {
  it('builds a localized link with a token that the opt-out endpoint accepts', () => {
    const url = rubricaOptOutUrl(
      { id: 'person-1', optedInToAddressBook: true },
      'https://portale.example.test/',
      'it',
    );
    expect(url).toMatch(/^https:\/\/portale\.example\.test\/it\/rubrica\/opt-out\?token=/);
    const token = new URL(url!).searchParams.get('token')!;
    expect(verifyRubricaOptOutToken(token)).toEqual({ personId: 'person-1' });
  });

  it('ogni chiamata emette un token nuovo, che vale da quel momento', () => {
    vi.useFakeTimers({ now: new Date('2026-11-06T10:00:00Z') });
    try {
      const persona = { id: 'person-1', optedInToAddressBook: true };
      const primo = rubricaOptOutUrl(persona, 'https://portale.example.test', 'it');
      // Oltre i 90 giorni del primo: solo il secondo funziona ancora.
      vi.setSystemTime(new Date('2027-03-01T10:00:00Z'));
      const secondo = rubricaOptOutUrl(persona, 'https://portale.example.test', 'it');
      expect(secondo).not.toBe(primo);
      expect(verifyRubricaOptOutToken(new URL(primo!).searchParams.get('token')!)).toBeNull();
      expect(verifyRubricaOptOutToken(new URL(secondo!).searchParams.get('token')!)).toEqual({
        personId: 'person-1',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives no link to someone who is not in the address book', () => {
    expect(rubricaOptOutUrl(null, 'https://portale.example.test', 'it')).toBeNull();
    expect(
      rubricaOptOutUrl({ id: 'p', optedInToAddressBook: false }, 'https://portale.example.test', 'it'),
    ).toBeNull();
  });
});
