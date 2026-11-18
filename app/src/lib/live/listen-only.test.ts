// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it } from 'vitest';

import { mediaDelToken, regolaConsenso } from './listen-only';

/**
 * Il consenso alla registrazione e i mezzi nel token di Jitsi. Non e' mai una
 * condizione per entrare, e un consenso negato tocca solo chi lo nega: quella
 * persona ha i limiti di tutti e resta fuori dalla registrazione. Solo dove la
 * voce non si puo' togliere il pubblico resta in solo ascolto, e ogni token
 * blocca tutto e lo dice (consentLock).
 */
const evento = {
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  multitrackRecordingEnabled: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
};
const TUTTO = { audio: true, video: true, desktop: true };

describe('regolaConsenso', () => {
  it('chiede il consenso dove si registra e si puo\' parlare', () => {
    expect(regolaConsenso(evento, true, 'rimovibile')).toEqual({
      registra: true,
      richiesto: true,
      soloAscolto: false,
    });
  });

  it('dove la voce non si puo\' togliere, senza consenso solo ascolto', () => {
    expect(regolaConsenso(evento, true, 'fissa').soloAscolto).toBe(true);
  });

  it('dove non si puo\' registrare non conta niente', () => {
    expect(regolaConsenso(evento, false, 'rimovibile')).toEqual({
      registra: false,
      richiesto: false,
      soloAscolto: false,
    });
  });

  it('senza un video completo la camera non entra in niente: non cambia nulla', () => {
    expect(regolaConsenso(evento, true, 'assente')).toEqual({
      registra: false,
      richiesto: true,
      soloAscolto: false,
    });
  });

  it('un evento che avvisa soltanto, dove la voce resta nel video, tiene i suoi limiti', () => {
    const regola = regolaConsenso({ ...evento, participantsCanUnmute: false }, true, 'fissa');
    expect(regola).toEqual({ registra: false, richiesto: false, soloAscolto: false });
  });

  it('un evento che avvisa soltanto registra lo stesso', () => {
    const regola = regolaConsenso({ ...evento, participantsCanUnmute: false }, true, 'rimovibile');
    expect(regola).toEqual({ registra: true, richiesto: false, soloAscolto: false });
  });

  it('una chiamata rapida registra chi acconsente, dove la voce si puo\' togliere', () => {
    const rapida = { ...evento, eventType: 'INSTANT' };
    expect(regolaConsenso(rapida, true, 'rimovibile')).toEqual({
      registra: true,
      richiesto: true,
      soloAscolto: false,
    });
    // Anche quando il pubblico non parla: si registra solo chi dice si'.
    expect(regolaConsenso({ ...rapida, participantsCanUnmute: false }, true, 'rimovibile')).toEqual({
      registra: true,
      richiesto: true,
      soloAscolto: false,
    });
  });

  it('una chiamata rapida non va mai in solo ascolto: dove la voce resta, non registra', () => {
    const niente = { registra: false, richiesto: false, soloAscolto: false };
    const rapida = { ...evento, eventType: 'INSTANT' };
    expect(regolaConsenso(rapida, true, 'fissa')).toEqual(niente);
    expect(regolaConsenso(rapida, true, 'assente')).toEqual(niente);
    expect(regolaConsenso(rapida, false, 'rimovibile')).toEqual(niente);
    expect(regolaConsenso({ ...rapida, recordingEnabled: false }, true, 'rimovibile')).toEqual(niente);
  });
});

describe('mediaDelToken in una chiamata rapida', () => {
  const rapida = {
    ...evento,
    eventType: 'INSTANT',
    participantsCanStartVideo: true,
    participantsCanShareScreen: true,
  };
  const aperto = { audio: false, video: false, desktop: false };

  it('chi partecipa entra con la voce fuori; chi modera e\' nel video', () => {
    const regola = regolaConsenso(rapida, true, 'rimovibile');
    expect(mediaDelToken(rapida, regola, 'moderatore', false)).toEqual({
      mediaLock: aperto,
      paInVideo: true,
    });
    expect(mediaDelToken(rapida, regola, 'partecipante', false)).toEqual({
      mediaLock: aperto,
      voiceExcluded: true,
    });
    expect(mediaDelToken(rapida, regola, 'partecipante', true)).toEqual({ mediaLock: aperto });
  });

  it('dove la voce resta nel video nessuno e\' escluso ne\' bloccato', () => {
    for (const voce of ['fissa', 'assente'] as const) {
      const regola = regolaConsenso(rapida, true, voce);
      for (const chi of ['moderatore', 'relatore', 'partecipante'] as const) {
        const media = mediaDelToken(rapida, regola, chi, false);
        expect(media.voiceExcluded).toBeUndefined();
        expect(media.listenOnly).toBeUndefined();
        expect(media.consentLock).toBeUndefined();
        expect(media.mediaLock).toEqual(aperto);
        expect(media.paInVideo).toBe(chi === 'partecipante' ? undefined : true);
      }
    }
  });
});

describe('mediaDelToken', () => {
  const regola = regolaConsenso(evento, true, 'rimovibile');
  const limiti = { audio: false, video: true, desktop: true };

  it('con il consenso, i limiti dell\'evento; chi conduce e\' nel video', () => {
    expect(mediaDelToken(evento, regola, 'moderatore', true)).toEqual({ mediaLock: limiti, paInVideo: true });
    expect(mediaDelToken(evento, regola, 'relatore', true)).toEqual({
      mediaLock: limiti,
      mediaExempt: true,
      paInVideo: true,
    });
    expect(mediaDelToken(evento, regola, 'partecipante', true)).toEqual({ mediaLock: limiti });
  });

  it('senza il consenso cambia solo il segno per la voce di chi partecipa', () => {
    expect(mediaDelToken(evento, regola, 'partecipante', false)).toEqual({
      mediaLock: limiti,
      voiceExcluded: true,
    });
  });

  it('chi conduce non da\' il consenso: e\' nel video comunque, e solo lui ha il segno', () => {
    for (const chi of ['moderatore', 'relatore'] as const) {
      expect(mediaDelToken(evento, regola, chi, false)).toEqual(mediaDelToken(evento, regola, chi, true));
      expect(mediaDelToken(evento, regola, chi, false).voiceExcluded).toBeUndefined();
    }
    for (const consenso of [false, true]) {
      expect(mediaDelToken(evento, regola, 'partecipante', consenso).paInVideo).toBeUndefined();
    }
  });

  it('un consenso negato non tocca i blocchi della sala', () => {
    const aperto = {
      ...evento,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
    };
    const r = regolaConsenso(aperto, true, 'rimovibile');
    const media = mediaDelToken(aperto, r, 'partecipante', false);
    expect(media.mediaLock).toEqual({ audio: false, video: false, desktop: false });
    expect(media.consentLock).toBeUndefined();
    expect(media.mediaAdmit).toBeUndefined();
  });

  it('dove la voce non si puo\' togliere il pubblico resta in solo ascolto, chi conduce no', () => {
    const r = regolaConsenso(evento, true, 'fissa');
    const base = { mediaLock: TUTTO, consentLock: true };
    expect(mediaDelToken(evento, r, 'partecipante', false)).toEqual({ ...base, listenOnly: true });
    expect(mediaDelToken(evento, r, 'partecipante', true)).toEqual({
      ...base,
      mediaAdmit: { audio: true, video: false, desktop: false },
    });
    expect(mediaDelToken(evento, r, 'moderatore', false)).toEqual({ ...base, paInVideo: true });
    expect(mediaDelToken(evento, r, 'relatore', false)).toEqual({
      ...base,
      mediaExempt: true,
      paInVideo: true,
    });
  });

  it('senza registrazione restano i limiti dell\'evento, e chi conduce ha il segno', () => {
    const r = regolaConsenso(evento, false, 'rimovibile');
    expect(mediaDelToken(evento, r, 'partecipante', false)).toEqual({ mediaLock: limiti });
    expect(mediaDelToken(evento, r, 'relatore', false)).toEqual({
      mediaLock: limiti,
      mediaExempt: true,
      paInVideo: true,
    });
  });
});
