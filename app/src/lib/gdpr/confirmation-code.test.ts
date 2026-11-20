// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DURATA_CODICE_MINUTI,
  emettiCodice,
  improntaValori,
  verificaCodice,
  type RichiestaConfermata,
} from './confirmation-code';

const richiesta: RichiestaConfermata = {
  azione: 'edit',
  emailHash: 'b'.repeat(64),
  oggetto: '11111111-1111-4111-8111-111111111111',
  impronta: improntaValori({ displayName: 'Anna Bianchi', organization: 'Comune' }),
};
const ORA = new Date('2026-11-18T10:00:00Z');
const dopo = (secondi: number) => new Date(ORA.getTime() + secondi * 1000);

beforeEach(() => vi.stubEnv('APP_SECRET', 'a'.repeat(64)));
afterEach(() => vi.unstubAllEnvs());

describe('il codice di conferma', () => {
  it('ha sei cifre e vale per la richiesta per cui e’ stato emesso', () => {
    const { codice, emessoIl } = emettiCodice(richiesta, ORA);
    expect(codice).toMatch(/^\d{6}$/);
    expect(emessoIl).toBe(ORA.getTime() / 1000);
    expect(verificaCodice(richiesta, emessoIl, codice, dopo(60))).toBe(true);
  });

  it('non vale per un’altra azione, un’altra iscrizione, altri valori o un altro indirizzo', () => {
    const { codice, emessoIl } = emettiCodice(richiesta, ORA);
    for (const altra of [
      { ...richiesta, azione: 'cancel' as const },
      { ...richiesta, oggetto: 'address:' },
      {
        ...richiesta,
        impronta: improntaValori({ displayName: 'Altro', organization: 'Comune' }),
      },
      { ...richiesta, emailHash: 'c'.repeat(64) },
    ]) {
      expect(verificaCodice(altra, emessoIl, codice, dopo(60))).toBe(false);
    }
  });

  it('scade, e non vale con un’ora di emissione cambiata o nel futuro', () => {
    const { codice, emessoIl } = emettiCodice(richiesta, ORA);
    expect(
      verificaCodice(richiesta, emessoIl, codice, dopo(DURATA_CODICE_MINUTI * 60))
    ).toBe(true);
    expect(
      verificaCodice(richiesta, emessoIl, codice, dopo(DURATA_CODICE_MINUTI * 60 + 1))
    ).toBe(false);
    expect(verificaCodice(richiesta, emessoIl + 1, codice, dopo(60))).toBe(false);
    expect(verificaCodice(richiesta, emessoIl, codice, dopo(-1))).toBe(false);
  });

  it('rifiuta un codice malformato senza confrontarlo', () => {
    const { emessoIl } = emettiCodice(richiesta, ORA);
    for (const codice of ['', '12345', '1234567', 'abcdef', ' 12345']) {
      expect(verificaCodice(richiesta, emessoIl, codice, dopo(1))).toBe(false);
    }
    expect(verificaCodice(richiesta, Number.NaN, '123456', dopo(1))).toBe(false);
  });

  it('dipende dal segreto dell’installazione', () => {
    const { codice, emessoIl } = emettiCodice(richiesta, ORA);
    vi.stubEnv('APP_SECRET', 'd'.repeat(64));
    expect(verificaCodice(richiesta, emessoIl, codice, dopo(1))).toBe(false);
  });
});

describe('improntaValori', () => {
  it('non dipende dall’ordine dei campi e distingue un ente vuoto', () => {
    expect(improntaValori({ a: 'x', b: null })).toBe(improntaValori({ b: null, a: 'x' }));
    expect(improntaValori({ a: 'x', b: null })).not.toBe(
      improntaValori({ a: 'x', b: '' })
    );
  });
});
