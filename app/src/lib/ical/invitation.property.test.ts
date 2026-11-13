// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Test basati su proprietà (fast-check) per l'escape e la piegatura delle
 * righe iCalendar: titoli, descrizioni e luoghi arrivano da chi organizza e
 * finiscono negli inviti. Un a capo o un separatore che sfugge all'escape
 * permette di aggiungere proprietà all'invito (iniezione nel file .ics).
 */
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { escapeIcsText, foldIcsLine } from './invitation';

const CONTROLLI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Testo qualsiasi, con una quota alta dei caratteri che l'escape tratta. Fino
 * a 300 unita': oltre i 75 ottetti di una riga, cosi' la piegatura scatta e
 * cade anche dentro i caratteri di piu' byte.
 */
const speciali = fc.constantFrom(
  '\\',
  ';',
  ',',
  '\n',
  '\r',
  '\t',
  '\u0000',
  '\u007f',
  'n',
  'a',
  'è',
  '😀'
);
const testo = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.string({ unit: 'binary', size: 'max', maxLength: 300 }),
  fc.string({ unit: speciali }),
  fc.string({ unit: speciali, size: 'max', maxLength: 300 })
);

/** Inverso dell'escape di RFC 5545 §3.3.11, da sinistra a destra. */
function deEscape(valore: string): string {
  return valore.replace(/\\([\\;,nN])/g, (_, c: string) =>
    c === 'n' || c === 'N' ? '\n' : c
  );
}

describe('escapeIcsText (proprietà)', () => {
  it('non lascia a capo, caratteri di controllo o separatori senza barra', () => {
    fc.assert(
      fc.property(testo, (s) => {
        const out = escapeIcsText(s);
        expect(out).not.toMatch(/[\r\n]/);
        expect(out).not.toMatch(CONTROLLI);
        // Tolte le sequenze di escape valide, non resta nessuna barra,
        // punto e virgola o virgola "nudi".
        expect(out.replace(/\\[\\;,n]/g, '')).not.toMatch(/[\\;,]/);
      })
    );
  });

  it('conserva il testo, a meno dei controlli e della forma degli a capo', () => {
    fc.assert(
      fc.property(testo, (s) => {
        const atteso = s.replace(CONTROLLI, '').replace(/\r\n|\r|\n/g, '\n');
        expect(deEscape(escapeIcsText(s))).toBe(atteso);
      })
    );
  });
});

describe('foldIcsLine (proprietà)', () => {
  // Una riga di contenuto non contiene a capo: la piegatura si applica dopo
  // l'escape, che li ha gia' trasformati.
  const riga = testo.map((s) => s.replace(/[\r\n]/g, ''));

  it('produce righe di al massimo 75 ottetti, le successive aperte da uno spazio', () => {
    fc.assert(
      fc.property(riga, (s) => {
        // La piegatura deve scattare per ogni riga che supera il limite.
        if (Buffer.byteLength(s, 'utf8') > 75) expect(foldIcsLine(s)).toContain('\r\n ');
        const righe = foldIcsLine(s).split('\r\n');
        for (const r of righe) {
          expect(Buffer.byteLength(r, 'utf8')).toBeLessThanOrEqual(75);
        }
        for (const r of righe.slice(1)) {
          expect(r.startsWith(' ')).toBe(true);
        }
      })
    );
  });

  it('si ricompone nella riga di partenza senza spezzare caratteri', () => {
    fc.assert(
      fc.property(riga, (s) => {
        expect(foldIcsLine(s).replace(/\r\n /g, '')).toBe(s);
      })
    );
  });
});
