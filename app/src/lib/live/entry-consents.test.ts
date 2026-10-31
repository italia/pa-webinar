import { describe, expect, it } from 'vitest';

import { consensiDaInviare, consensoRegistrazioneIngresso } from './entry-consents';

const interattivo = {
  recordingEnabled: true,
  multitrackRecordingEnabled: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};
const soloAscolto = { ...interattivo, participantsCanUnmute: false };
const base = { formato: interattivo, registrazioneDisponibile: true, conduce: false, giaDato: false };

describe('consensoRegistrazioneIngresso', () => {
  it('chi partecipa e non l\'ha dato lo da\' in sala d\'attesa', () => {
    expect(consensoRegistrazioneIngresso(base)).toEqual({ richiesto: true, facoltativo: false, soloAscolto: false });
  });

  it('chi l\'ha gia\' dato (iscrizione o sala) entra senza', () => {
    expect(consensoRegistrazioneIngresso({ ...base, giaDato: true }).richiesto).toBe(false);
  });

  it('moderatori e relatori non lo vedono, nemmeno come informativa', () => {
    expect(consensoRegistrazioneIngresso({ ...base, conduce: true })).toEqual({
      richiesto: false,
      facoltativo: false,
      soloAscolto: false,
    });
    expect(
      consensoRegistrazioneIngresso({ ...base, formato: soloAscolto, conduce: true }).soloAscolto,
    ).toBe(false);
  });

  it('di solo ascolto si informa e basta', () => {
    expect(consensoRegistrazioneIngresso({ ...base, formato: soloAscolto })).toEqual({
      richiesto: false,
      facoltativo: false,
      soloAscolto: true,
    });
  });

  it('senza registrazione, o senza nulla che possa registrare, niente', () => {
    const niente = { richiesto: false, facoltativo: false, soloAscolto: false };
    expect(
      consensoRegistrazioneIngresso({ ...base, formato: { ...interattivo, recordingEnabled: false } }),
    ).toEqual(niente);
    expect(consensoRegistrazioneIngresso({ ...base, registrazioneDisponibile: false })).toEqual(niente);
  });
});

describe('consensoRegistrazioneIngresso — solo ascolto per chi non acconsente', () => {
  it('chiesto ma libero; chi l\'ha dato non lo rivede', () => {
    const libero = { ...base, formato: { ...base.formato, listenOnlyWithoutConsent: true } };
    expect(consensoRegistrazioneIngresso(libero)).toEqual({ richiesto: true, facoltativo: true, soloAscolto: false });
    expect(consensoRegistrazioneIngresso({ ...libero, giaDato: true }).facoltativo).toBe(false);
  });
});

describe('consensiDaInviare', () => {
  const nessuno = { registrazione: false, tracce: false };

  it('manda i consensi dati ora in sala', () => {
    expect(consensiDaInviare({ recordingConsent: true, multitrackConsent: true }, nessuno)).toEqual({
      registrazione: true,
      tracce: true,
    });
  });

  it('a un rientro o a una riconnessione li rimanda: il posto e\' nuovo, e vuole la sua prova', () => {
    expect(consensiDaInviare({}, { registrazione: true, tracce: false })).toEqual({
      registrazione: true,
      tracce: false,
    });
  });

  it('senza consenso dato non manda niente', () => {
    expect(consensiDaInviare({}, nessuno)).toEqual(nessuno);
  });
});
