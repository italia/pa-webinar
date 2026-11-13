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

  it('una chiamata rapida non chiede consensi', () => {
    expect(regolaConsenso({ ...evento, eventType: 'INSTANT' }, true, 'rimovibile')).toEqual({
      registra: false,
      richiesto: false,
      soloAscolto: false,
    });
  });
});

describe('mediaDelToken', () => {
  const regola = regolaConsenso(evento, true, 'rimovibile');
  const limiti = { audio: false, video: true, desktop: true };

  it('con il consenso, i limiti dell\'evento', () => {
    expect(mediaDelToken(evento, regola, 'moderatore', true)).toEqual({ mediaLock: limiti });
    expect(mediaDelToken(evento, regola, 'relatore', true)).toEqual({ mediaLock: limiti, mediaExempt: true });
    expect(mediaDelToken(evento, regola, 'partecipante', true)).toEqual({ mediaLock: limiti });
  });

  it('senza il consenso cambia solo il segno per la registrazione, chiunque sia', () => {
    for (const chi of ['moderatore', 'relatore', 'partecipante'] as const) {
      expect(mediaDelToken(evento, regola, chi, false)).toEqual({
        ...mediaDelToken(evento, regola, chi, true),
        voiceExcluded: true,
      });
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
    expect(mediaDelToken(evento, r, 'moderatore', false)).toEqual(base);
    expect(mediaDelToken(evento, r, 'relatore', false)).toEqual({ ...base, mediaExempt: true });
  });

  it('senza registrazione restano i limiti dell\'evento', () => {
    const r = regolaConsenso(evento, false, 'rimovibile');
    expect(mediaDelToken(evento, r, 'partecipante', false)).toEqual({ mediaLock: limiti });
    expect(mediaDelToken(evento, r, 'relatore', false)).toEqual({ mediaLock: limiti, mediaExempt: true });
  });
});
