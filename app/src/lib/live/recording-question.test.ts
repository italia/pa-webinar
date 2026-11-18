// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  aggiornaDomanda,
  domandaAperta,
  DOMANDA_INIZIALE,
  type EventoDomanda,
  type StatoDomanda,
} from './recording-question';

const avvio: EventoDomanda = { tipo: 'registrazione', inCorso: true };
const arresto: EventoDomanda = { tipo: 'registrazione', inCorso: false };
const dopo = (...eventi: EventoDomanda[]): StatoDomanda =>
  eventi.reduce(aggiornaDomanda, DOMANDA_INIZIALE);

describe("la domanda a chi e' fuori dalla registrazione", () => {
  it("finche' nessuno registra non si chiede niente", () => {
    expect(domandaAperta(DOMANDA_INIZIALE, true)).toBe(false);
    expect(domandaAperta(dopo(avvio, arresto), true)).toBe(false);
  });

  it("all'avvio si chiede a chi e' fuori, non a chi e' dentro", () => {
    const s = dopo(avvio);
    expect(domandaAperta(s, true)).toBe(true);
    expect(domandaAperta(s, false)).toBe(false);
    // Senza un token la sala non sa ancora com'e' entrata la persona.
    expect(domandaAperta(s, null)).toBe(false);
  });

  it('un no vale per quella registrazione: alla successiva si richiede', () => {
    const no = dopo(avvio, { tipo: 'risposta' });
    expect(domandaAperta(no, true)).toBe(false);
    expect(domandaAperta(aggiornaDomanda(no, avvio), true)).toBe(false);
    const nuova = dopo(avvio, { tipo: 'risposta' }, arresto, avvio);
    expect(domandaAperta(nuova, true)).toBe(true);
  });

  it("chi nel giro e' stato nella registrazione e poi ritira non se la vede richiedere", () => {
    const ritirato = dopo(avvio, { tipo: 'dentro' });
    expect(domandaAperta(ritirato, true)).toBe(false);
    // Alla registrazione dopo, fuori, la domanda torna.
    expect(domandaAperta(dopo(avvio, { tipo: 'dentro' }, arresto, avvio), true)).toBe(
      true
    );
  });

  it('chi entra a registrazione in corso riceve la domanda', () => {
    // Il primo stato visto e' gia' «in corso»: e' un giro per lui.
    expect(domandaAperta(dopo(avvio), true)).toBe(true);
  });

  it('lo stesso stato ripetuto non apre un giro nuovo', () => {
    const s = dopo(avvio, { tipo: 'risposta' }, avvio, avvio);
    expect(s.giro).toBe(1);
    expect(domandaAperta(s, true)).toBe(false);
  });

  it('fuori da una registrazione risposte e presenze non contano', () => {
    const s = dopo({ tipo: 'risposta' }, { tipo: 'dentro' }, avvio);
    expect(domandaAperta(s, true)).toBe(true);
  });
});
