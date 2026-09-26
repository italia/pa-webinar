import { describe, it, expect } from 'vitest';

import {
  annuncioApertura,
  statoIngresso,
  type StatoIngressoInput,
} from './entry-state';

const base: StatoIngressoInput = {
  canEnterLive: true,
  ingressoConsentito: true,
  nameValid: true,
  emailValid: true,
  multitrackRequired: false,
  multitrackConsent: false,
  ingressoTentato: false,
  nomeNoto: true,
};
const stato = (o: Partial<StatoIngressoInput>) => statoIngresso({ ...base, ...o });

describe('statoIngresso — modulo completo', () => {
  it('sala aperta e modulo a posto: si entra, niente da chiedere', () => {
    expect(stato({})).toEqual({
      canEnter: true,
      ingressoAperto: true,
      bloccoModulo: null,
      nomeDaChiedere: false,
      nomeSegnalato: false,
      bloccoSpiegato: null,
    });
  });
});

describe('statoIngresso — nome mancante', () => {
  it('a sala aperta il nome si chiede subito, come indicazione e non come errore', () => {
    const s = stato({ nameValid: false });
    expect(s.canEnter).toBe(false);
    expect(s.ingressoAperto).toBe(true);
    expect(s.bloccoModulo).toBe('name');
    expect(s.nomeDaChiedere).toBe(true);
    expect(s.nomeSegnalato).toBe(false);
    expect(s.bloccoSpiegato).toBe('name');
  });

  it('prima di aver letto il nome salvato nel browser non lo chiede, e non si entra', () => {
    const s = stato({ nameValid: false, nomeNoto: false });
    expect(s.nomeDaChiedere).toBe(false);
    expect(s.bloccoSpiegato).toBeNull();
    expect(s.canEnter).toBe(false);
    expect(s.bloccoModulo).toBe('name');
  });

  it('dopo un tentativo diventa un errore', () => {
    const s = stato({ nameValid: false, ingressoTentato: true });
    expect(s.nomeDaChiedere).toBe(true);
    expect(s.nomeSegnalato).toBe(true);
  });

  it('il nome viene prima dell\'email e del consenso: e\' il primo campo della pagina', () => {
    const s = stato({
      nameValid: false,
      emailValid: false,
      multitrackRequired: true,
      multitrackConsent: false,
    });
    expect(s.bloccoModulo).toBe('name');
  });
});

describe('statoIngresso — la sala che aspetta resta distinta dal nome', () => {
  it('evento non avviato (conto alla rovescia): il nome non si chiede', () => {
    const s = stato({ canEnterLive: false, nameValid: false });
    expect(s.ingressoAperto).toBe(false);
    expect(s.nomeDaChiedere).toBe(false);
    expect(s.bloccoSpiegato).toBeNull();
    expect(s.canEnter).toBe(false);
  });

  it('sala in preparazione: il nome non si chiede', () => {
    const s = stato({ ingressoConsentito: false, nameValid: false });
    expect(s.ingressoAperto).toBe(false);
    expect(s.nomeDaChiedere).toBe(false);
  });

  it('sala in preparazione con modulo completo: non si entra, e non c\'e\' un campo da indicare', () => {
    const s = stato({ ingressoConsentito: false });
    expect(s.canEnter).toBe(false);
    expect(s.bloccoModulo).toBeNull();
  });

  it('un tentativo a sala chiusa (ritorno dalla registrazione) chiede comunque il nome', () => {
    const s = stato({ canEnterLive: false, nameValid: false, ingressoTentato: true });
    expect(s.nomeDaChiedere).toBe(true);
    expect(s.nomeSegnalato).toBe(true);
  });
});

describe('statoIngresso — email e consenso', () => {
  it('email non valida: blocca, e il nome non si chiede', () => {
    const s = stato({ emailValid: false });
    expect(s.canEnter).toBe(false);
    expect(s.bloccoModulo).toBe('email');
    expect(s.bloccoSpiegato).toBe('email');
    expect(s.nomeDaChiedere).toBe(false);
  });

  it('consenso alla registrazione per partecipante mancante: blocca', () => {
    const s = stato({ multitrackRequired: true, multitrackConsent: false });
    expect(s.canEnter).toBe(false);
    expect(s.bloccoModulo).toBe('consent');
  });

  it('consenso dato: si entra', () => {
    expect(stato({ multitrackRequired: true, multitrackConsent: true }).canEnter).toBe(true);
  });
});

describe('annuncioApertura', () => {
  it('fuori dall\'istante di apertura non annuncia nulla', () => {
    expect(
      annuncioApertura({ appenaAperta: false, canEnter: true, bloccoModulo: null }),
    ).toBeNull();
  });

  it('sala appena aperta e si entra: «la sala e\' pronta — entra»', () => {
    expect(
      annuncioApertura({ appenaAperta: true, canEnter: true, bloccoModulo: null }),
    ).toBe('roomJustOpened');
  });

  it('sala appena aperta ma senza nome: lo dice, invece di invitare a entrare', () => {
    expect(
      annuncioApertura({ appenaAperta: true, canEnter: false, bloccoModulo: 'name' }),
    ).toBe('roomOpenNameMissing');
  });

  it('sala appena aperta con consenso mancante: annuncia l\'apertura', () => {
    expect(
      annuncioApertura({ appenaAperta: true, canEnter: false, bloccoModulo: 'consent' }),
    ).toBe('roomOpen');
  });
});
