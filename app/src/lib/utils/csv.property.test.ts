// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

/**
 * Test basati su proprietà (fast-check) per le celle CSV delle esportazioni:
 * i valori vengono da chi si iscrive o partecipa, e un foglio di calcolo
 * esegue come formula una cella che comincia con =, +, -, @ (CSV injection).
 */
import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

import { CSV_SEPARATOR, csvCell, csvText } from './csv';

// I caratteri iniziali che un foglio di calcolo interpreta come formula,
// dall'elenco OWASP (CSV Injection): uguale, piu', meno, chiocciola,
// tabulazione e ritorno a capo. Scritti qui dalla specifica, non copiati
// dall'implementazione.
const PREFISSI_FORMULA = ['=', '+', '-', '@', '\t', '\r'];
const iniziaComeFormula = (v: string) => PREFISSI_FORMULA.some((p) => v.startsWith(p));

const valore = fc.oneof(
  fc.string({ unit: 'binary' }),
  fc.string({
    unit: fc.constantFrom(
      '=',
      '+',
      '-',
      '@',
      '\t',
      '\r',
      '\n',
      '"',
      ';',
      ',',
      "'",
      'a',
      '1',
      'è'
    ),
  })
);

/** Il valore che un foglio di calcolo legge dalla cella. */
function letta(cella: string): string {
  if (cella.length >= 2 && cella.startsWith('"') && cella.endsWith('"')) {
    return cella.slice(1, -1).replace(/""/g, '"');
  }
  return cella;
}

/** Lettore RFC 4180 minimo, con il separatore delle esportazioni. */
function analizza(testo: string): string[][] {
  const righe: string[][] = [];
  let riga: string[] = [];
  let campo = '';
  let fraVirgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (fraVirgolette) {
      if (c === '"' && testo[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        fraVirgolette = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      fraVirgolette = true;
    } else if (c === CSV_SEPARATOR) {
      riga.push(campo);
      campo = '';
    } else if (c === '\r' && testo[i + 1] === '\n') {
      riga.push(campo);
      righe.push(riga);
      riga = [];
      campo = '';
      i++;
    } else {
      campo += c;
    }
  }
  return righe;
}

describe('csvCell (proprietà)', () => {
  it('non produce mai una cella che il foglio legge come formula', () => {
    fc.assert(
      fc.property(valore, (v) => {
        expect(iniziaComeFormula(letta(csvCell(v)))).toBe(false);
      })
    );
  });

  it("conserva il valore, con l'apice davanti solo dove serve", () => {
    fc.assert(
      fc.property(valore, (v) => {
        const atteso = iniziaComeFormula(v) ? `'${v}` : v;
        expect(letta(csvCell(v))).toBe(atteso);
      })
    );
  });
});

describe('csvText (proprietà)', () => {
  it('si rilegge con le stesse righe e le stesse colonne', () => {
    // Almeno una riga: le esportazioni hanno sempre l'intestazione.
    const righe = fc.array(fc.array(valore, { minLength: 1, maxLength: 5 }), {
      minLength: 1,
      maxLength: 5,
    });
    fc.assert(
      fc.property(righe, (rs) => {
        const attese = rs.map((r) => r.map((v) => (iniziaComeFormula(v) ? `'${v}` : v)));
        expect(analizza(csvText(rs))).toEqual(attese);
      })
    );
  });
});
