import { describe, expect, it } from 'vitest';

import { isRoundExpired, normalizeWord, WORD_ROUND_NO_LIMIT, countWordsByPerson } from './normalize';

describe('normalizeWord', () => {
  it('maiuscole, spazi e punteggiatura ai bordi non contano', () => {
    expect(normalizeWord('Chiarezza!')).toBe('chiarezza');
    expect(normalizeWord('  chiarezza  ')).toBe('chiarezza');
    expect(normalizeWord('#Chiarezza.')).toBe('chiarezza');
    expect(normalizeWord('«confronto»')).toBe('confronto');
  });

  it('apostrofi, trattini e spazi interni restano', () => {
    expect(normalizeWord("L'ascolto")).toBe("l'ascolto");
    expect(normalizeWord('e-government')).toBe('e-government');
    expect(normalizeWord('cloud   first')).toBe('cloud first');
  });

  it('lettere accentate e numeri sono parole', () => {
    expect(normalizeWord('Città')).toBe('città');
    expect(normalizeWord('2026')).toBe('2026');
  });

  it('solo simboli: parola vuota', () => {
    expect(normalizeWord('!!!')).toBe('');
    expect(normalizeWord('🚀')).toBe('');
  });
});

describe('isRoundExpired', () => {
  const createdAt = new Date('2026-10-08T10:00:00Z');

  it('scade allo scadere della durata', () => {
    expect(isRoundExpired({ duration: 60, createdAt }, createdAt.getTime() + 59_000)).toBe(false);
    expect(isRoundExpired({ duration: 60, createdAt }, createdAt.getTime() + 61_000)).toBe(true);
  });

  it('senza limite non scade mai', () => {
    expect(
      isRoundExpired({ duration: WORD_ROUND_NO_LIMIT, createdAt }, createdAt.getTime() + 8 * 3600_000),
    ).toBe(false);
  });
});

describe('countWordsByPerson', () => {
  it('conta le persone, non gli invii, e unisce le forme della stessa parola', () => {
    expect(
      countWordsByPerson([
        { word: 'Chiarezza!', registrationId: 'r1', guestId: null },
        { word: 'chiarezza', registrationId: 'r1', guestId: null },
        { word: 'chiarezza', registrationId: null, guestId: 'g1' },
        { word: 'ascolto', registrationId: null, guestId: 'g1' },
      ]),
    ).toEqual([
      { word: 'chiarezza', count: 2 },
      { word: 'ascolto', count: 1 },
    ]);
  });

  it('su piu’ domande, una persona conta una volta per domanda', () => {
    expect(
      countWordsByPerson([
        { word: 'fiducia', registrationId: 'r1', guestId: null, roundId: 'd1' },
        { word: 'fiducia', registrationId: 'r1', guestId: null, roundId: 'd2' },
      ]),
    ).toEqual([{ word: 'fiducia', count: 2 }]);
  });

  it('salta cio’ che normalizzato resta vuoto', () => {
    expect(countWordsByPerson([{ word: '!!!', registrationId: 'r1', guestId: null }])).toEqual([]);
  });
});
