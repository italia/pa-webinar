import { describe, expect, it } from 'vitest';

import { mediaDelToken, regolaConsenso } from './listen-only';

/**
 * Il consenso alla registrazione e i mezzi nel token di Jitsi: con il solo
 * ascolto ogni token blocca tutto e lo dice (consentLock); chi acconsente e'
 * ammesso per cio' che l'evento concede, chi no resta in solo ascolto.
 */
const evento = {
  eventType: 'SCHEDULED',
  recordingEnabled: true,
  multitrackRecordingEnabled: false,
  participantsCanUnmute: true,
  participantsCanStartVideo: false,
  participantsCanShareScreen: false,
  listenOnlyWithoutConsent: true,
};
const TUTTO = { audio: true, video: true, desktop: true };

describe('regolaConsenso', () => {
  it("chiede il consenso dove si registra e si puo' parlare; libero con il solo ascolto", () => {
    expect(regolaConsenso(evento, true)).toEqual({ richiesto: true, soloAscolto: true });
    expect(regolaConsenso({ ...evento, listenOnlyWithoutConsent: false }, true)).toEqual({
      richiesto: true,
      soloAscolto: false,
    });
    expect(regolaConsenso(evento, false)).toEqual({
      richiesto: false,
      soloAscolto: false,
    });
  });

  it('una chiamata rapida non chiede consensi', () => {
    expect(regolaConsenso({ ...evento, eventType: 'INSTANT' }, true)).toEqual({
      richiesto: false,
      soloAscolto: false,
    });
  });
});

describe('mediaDelToken', () => {
  const regola = regolaConsenso(evento, true);

  it('con il solo ascolto ogni token blocca tutto e lo dice', () => {
    expect(mediaDelToken(evento, regola, 'moderatore', true)).toEqual({
      mediaLock: TUTTO,
      consentLock: true,
    });
    expect(mediaDelToken(evento, regola, 'relatore', true)).toEqual({
      mediaLock: TUTTO,
      consentLock: true,
      mediaExempt: true,
    });
    expect(mediaDelToken(evento, regola, 'partecipante', false)).toEqual({
      mediaLock: TUTTO,
      consentLock: true,
      listenOnly: true,
    });
    expect(mediaDelToken(evento, regola, 'partecipante', true)).toEqual({
      mediaLock: TUTTO,
      consentLock: true,
      mediaAdmit: { audio: true, video: false, desktop: false },
    });
  });

  it("senza il solo ascolto restano i limiti dell'evento", () => {
    const r = regolaConsenso({ ...evento, listenOnlyWithoutConsent: false }, true);
    expect(mediaDelToken(evento, r, 'partecipante', true)).toEqual({
      mediaLock: { audio: false, video: true, desktop: true },
    });
    expect(mediaDelToken(evento, r, 'relatore', true)).toEqual({
      mediaLock: { audio: false, video: true, desktop: true },
      mediaExempt: true,
    });
  });
});
