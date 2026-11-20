// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Test basati su proprietà (fast-check) per la cifratura dei dati personali
 * a riposo: qualunque testo torna identico, un byte alterato non si decifra
 * mai in silenzio, e la lettura tollerante non scambia per cifrato un testo
 * in chiaro.
 */
import fc from 'fast-check';
import { describe, it, expect, beforeAll } from 'vitest';

import { decryptPII, encryptPII, hashEmail, tryDecryptPII } from './pii';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = TEST_KEY;
  process.env.APP_SECRET = 'test-app-secret';
});

// Testo Unicode ben formato: un surrogato isolato non sopravvive alla codifica
// UTF-8 di nessun database, quindi non e' un dato personale possibile.
const testo = fc.oneof(
  fc.string({ unit: 'grapheme' }),
  fc.string({ unit: 'grapheme', size: 'max', maxLength: 300 })
);

describe('encryptPII / decryptPII (proprietà)', () => {
  it('qualunque testo torna identico', () => {
    fc.assert(
      fc.property(testo, (s) => {
        expect(decryptPII(encryptPII(s))).toBe(s);
        expect(tryDecryptPII(encryptPII(s))).toBe(s);
      })
    );
  });

  it('due cifrature dello stesso testo non coincidono', () => {
    fc.assert(
      fc.property(testo, (s) => {
        expect(encryptPII(s)).not.toBe(encryptPII(s));
      })
    );
  });

  it('un bit alterato in qualunque punto fa fallire la decifratura', () => {
    fc.assert(
      fc.property(testo, fc.nat(), fc.integer({ min: 0, max: 7 }), (s, pos, bit) => {
        const buf = Buffer.from(encryptPII(s), 'base64');
        const i = pos % buf.length;
        buf.writeUInt8(buf.readUInt8(i) ^ (1 << bit), i);
        const alterato = buf.toString('base64');
        expect(() => decryptPII(alterato)).toThrow();
        // La lettura tollerante restituisce il valore com'e', mai un testo
        // decifrato a meta'.
        expect(tryDecryptPII(alterato)).toBe(alterato);
      })
    );
  });
});

describe('tryDecryptPII (proprietà)', () => {
  it("lascia com'e' un testo in chiaro e non lancia", () => {
    // Anche oltre i 40 caratteri, dove la lettura prova davvero a decifrare.
    const inChiaro = fc.oneof(
      fc.string({ unit: 'binary' }),
      fc.string({ unit: 'binary', minLength: 40, maxLength: 300, size: 'max' }),
      fc.base64String({ minLength: 40, maxLength: 300, size: 'max' })
    );
    fc.assert(
      fc.property(inChiaro, (s) => {
        expect(tryDecryptPII(s)).toBe(s);
      })
    );
  });
});

describe('hashEmail (proprietà)', () => {
  it('non distingue maiuscole e spazi ai bordi', () => {
    fc.assert(
      fc.property(
        fc.emailAddress(),
        fc.constantFrom('', ' ', '\t', '  '),
        (email, bordo) => {
          expect(hashEmail(`${bordo}${email.toUpperCase()}${bordo}`)).toBe(
            hashEmail(email)
          );
        }
      )
    );
  });
});
