// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import {
  consensiDaInviare,
  consensoRegistrazioneIngresso,
  consensoTrascrizioneIngresso,
  registraChiConduce,
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

  it('moderatori e relatori non lo danno: sono sempre nel video', () => {
    const niente = { richiesto: false, soloAscolto: false };
    expect(consensoRegistrazioneIngresso({ ...base, conduce: true })).toEqual(niente);
    expect(consensoRegistrazioneIngresso({ ...base, formato: soloAscolto, conduce: true })).toEqual(niente);
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

describe('consensoRegistrazioneIngresso — chiamata rapida', () => {
  it('nessuno lo da\' all\'ingresso: la domanda arriva in sala, a registrazione avviata', () => {
    const niente = { richiesto: false, soloAscolto: false };
    expect(consensoRegistrazioneIngresso({ ...base, istantanea: true })).toEqual(niente);
    expect(consensoRegistrazioneIngresso({ ...base, conduce: true, istantanea: true })).toEqual(niente);
    expect(
      consensoRegistrazioneIngresso({ ...base, formato: soloAscolto, istantanea: true })
    ).toEqual(niente);
  });
});

describe('registraChiConduce', () => {
  it('un evento a calendario registra chi conduce dove si puo\' registrare, qualunque sia la voce', () => {
    for (const voce of [undefined, 'assente', 'rimovibile', 'fissa'] as const) {
      expect(registraChiConduce({ recordingEnabled: true }, true, voce)).toBe(true);
      expect(registraChiConduce({ recordingEnabled: true, eventType: 'SCHEDULED' }, true, voce)).toBe(true);
      expect(registraChiConduce({ recordingEnabled: false }, true, voce)).toBe(false);
      expect(registraChiConduce({ recordingEnabled: true }, false, voce)).toBe(false);
    }
  });

  it('una chiamata rapida solo dove chi non acconsente resta fuori dal video', () => {
    const rapida = { recordingEnabled: true, eventType: 'INSTANT' };
    expect(registraChiConduce(rapida, true, 'rimovibile')).toBe(true);
    expect(registraChiConduce(rapida, true, 'fissa')).toBe(false);
    expect(registraChiConduce(rapida, true, 'assente')).toBe(false);
    expect(registraChiConduce(rapida, true)).toBe(false);
    expect(registraChiConduce(rapida, false, 'rimovibile')).toBe(false);
    expect(registraChiConduce({ ...rapida, recordingEnabled: false }, true, 'rimovibile')).toBe(false);
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

  it('nella chiamata rapida che registra non si chiede all\'ingresso: vale solo con la registrazione', () => {
    for (const formato of [
      { multitrackRecordingEnabled: true },
      { captionsTranscript: true },
      { trascrizioneVideo: true },
    ]) {
      expect(
        consensoTrascrizioneIngresso({ formato, concluso: false, voce: 'rimovibile', registrazioneInSala: true })
      ).toBe(false);
      expect(consensoTrascrizioneIngresso({ formato, concluso: false, voce: 'rimovibile' })).toBe(true);
    }
  });

  it("senza nessuna trascrizione non c'e' casella", () => {
    expect(consensoTrascrizioneIngresso({ formato: {}, concluso: false })).toBe(false);
  });
});

describe('consensiDaInviare', () => {
  const nessuno = { registrazione: false, tracce: false };

  it('i consensi dati ora con un clic restano un clic', () => {
    expect(consensiDaInviare({ recordingConsent: true, multitrackConsent: true }, nessuno)).toEqual({
      dati: { registrazione: true, tracce: true },
      repliche: nessuno,
    });
  });

  it("a un rientro quelli gia' salvati sono repliche, mai un clic", () => {
    expect(consensiDaInviare({}, { registrazione: true, tracce: false })).toEqual({
      dati: nessuno,
      repliche: { registrazione: true, tracce: false },
    });
  });

  it('un clic prevale sulla replica dello stesso consenso, non sull altro', () => {
    expect(
      consensiDaInviare({ recordingConsent: true }, { registrazione: true, tracce: true })
    ).toEqual({
      dati: { registrazione: true, tracce: false },
      repliche: { registrazione: false, tracce: true },
    });
  });

  it('senza consenso dato non manda niente', () => {
    expect(consensiDaInviare({}, nessuno)).toEqual({ dati: nessuno, repliche: nessuno });
  });
});
