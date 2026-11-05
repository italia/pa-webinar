// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  consensiDaInviare,
  consensoRegistrazioneIngresso,
  consensoTrascrizioneIngresso,
} from './entry-consents';

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
    expect(consensoRegistrazioneIngresso(base)).toEqual({ richiesto: true, soloAscolto: false });
  });

  it('chi l\'ha gia\' dato (iscrizione o sala) entra senza', () => {
    expect(consensoRegistrazioneIngresso({ ...base, giaDato: true }).richiesto).toBe(false);
  });

  it('moderatori e relatori lo danno in ogni evento che registra, facoltativo', () => {
    expect(consensoRegistrazioneIngresso({ ...base, conduce: true })).toEqual({
      richiesto: true,
      soloAscolto: false,
    });
    // Anche quando chi partecipa e' di solo ascolto: e' la loro voce a essere registrata.
    expect(consensoRegistrazioneIngresso({ ...base, formato: soloAscolto, conduce: true })).toEqual({
      richiesto: true,
      soloAscolto: false,
    });
  });

  it('l\'evento che tiene chi conduce sempre nella registrazione non glielo chiede', () => {
    const sempre = { ...base, conduceSempreRegistrato: true };
    expect(consensoRegistrazioneIngresso({ ...sempre, conduce: true }).richiesto).toBe(false);
    expect(consensoRegistrazioneIngresso(sempre).richiesto).toBe(true);
  });

  it('moderatori e relatori: non a chi l\'ha gia\' dato, non senza registrazione, non in una chiamata rapida', () => {
    const conduce = { ...base, conduce: true };
    expect(consensoRegistrazioneIngresso({ ...conduce, giaDato: true }).richiesto).toBe(false);
    expect(consensoRegistrazioneIngresso({ ...conduce, registrazioneDisponibile: false }).richiesto).toBe(false);
    expect(
      consensoRegistrazioneIngresso({ ...conduce, formato: { ...interattivo, recordingEnabled: false } }).richiesto,
    ).toBe(false);
    expect(consensoRegistrazioneIngresso({ ...conduce, istantanea: true }).richiesto).toBe(false);
  });

  it('di solo ascolto si informa e basta', () => {
    expect(consensoRegistrazioneIngresso({ ...base, formato: soloAscolto })).toEqual({
      richiesto: false,
      soloAscolto: true,
    });
  });

  it('senza registrazione, o senza nulla che possa registrare, niente', () => {
    const niente = { richiesto: false, soloAscolto: false };
    expect(
      consensoRegistrazioneIngresso({ ...base, formato: { ...interattivo, recordingEnabled: false } }),
    ).toEqual(niente);
    expect(consensoRegistrazioneIngresso({ ...base, registrazioneDisponibile: false })).toEqual(niente);
  });
});

describe('consensoRegistrazioneIngresso — solo ascolto per chi non acconsente', () => {
  it('chiesto ma libero; chi l\'ha dato non lo rivede', () => {
    expect(consensoRegistrazioneIngresso(base)).toEqual({ richiesto: true, soloAscolto: false });
  });
});

describe('consensoTrascrizioneIngresso', () => {
  const siNo = [false, true];
  const voci = ['assente', 'rimovibile', 'fissa'] as const;

  it("con tracce e sottotitoli risponde come la condizione della sala d'attesa", () => {
    for (const multitrackRecordingEnabled of siNo) {
      for (const captionsTranscript of siNo) {
        for (const concluso of siNo) {
          for (const giaDato of siNo) {
            for (const soloAscolto of siNo) {
              for (const voce of voci) {
                const atteso =
                  (multitrackRecordingEnabled || captionsTranscript) &&
                  !concluso &&
                  !giaDato &&
                  !(voce === 'rimovibile' && soloAscolto);
                expect(
                  consensoTrascrizioneIngresso({
                    formato: { multitrackRecordingEnabled, captionsTranscript },
                    concluso,
                    giaDato,
                    voce,
                    soloAscolto,
                  }),
                ).toBe(atteso);
              }
            }
          }
        }
      }
    }
  });

  it('con il solo formato risponde come la condizione della finestra dei consensi', () => {
    for (const multitrackRecordingEnabled of siNo) {
      for (const captionsTranscript of siNo) {
        for (const concluso of siNo) {
          expect(
            consensoTrascrizioneIngresso({
              formato: { multitrackRecordingEnabled, captionsTranscript },
              concluso,
            }),
          ).toBe((multitrackRecordingEnabled || captionsTranscript) && !concluso);
        }
      }
    }
  });

  it('la trascrizione dal video apre la casella come le altre due', () => {
    const formato = { trascrizioneVideo: true };
    expect(consensoTrascrizioneIngresso({ formato, concluso: false })).toBe(true);
    expect(consensoTrascrizioneIngresso({ formato, concluso: true })).toBe(false);
    expect(consensoTrascrizioneIngresso({ formato, concluso: false, giaDato: true })).toBe(false);
    expect(
      consensoTrascrizioneIngresso({ formato, concluso: false, voce: 'rimovibile', soloAscolto: true }),
    ).toBe(false);
    expect(
      consensoTrascrizioneIngresso({ formato, concluso: false, voce: 'fissa', soloAscolto: true }),
    ).toBe(true);
  });

  it("senza nessuna trascrizione non c'e' casella", () => {
    expect(consensoTrascrizioneIngresso({ formato: {}, concluso: false })).toBe(false);
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
