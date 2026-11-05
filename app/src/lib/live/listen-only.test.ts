import { describe, expect, it } from 'vitest';

import { mediaDelToken, regolaConsenso } from './listen-only';

/**
 * Il consenso alla registrazione e i mezzi nel token di Jitsi. Non e' mai una
 * condizione per entrare: in un evento che registra ogni token blocca tutto e
 * lo dice (consentLock), chi acconsente e' ammesso per cio' che l'evento
 * concede, chi no parla con la voce tolta dal video, oppure, dove la voce non
 * si puo' togliere, resta in solo ascolto.
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
  const base = { mediaLock: TUTTO, consentLock: true };

  it('con il consenso, cio\' che l\'evento concede', () => {
    expect(mediaDelToken(evento, regola, 'moderatore', true)).toEqual(base);
    expect(mediaDelToken(evento, regola, 'relatore', true)).toEqual({ ...base, mediaExempt: true });
    expect(mediaDelToken(evento, regola, 'partecipante', true)).toEqual({
      ...base,
      mediaAdmit: { audio: true, video: false, desktop: false },
    });
  });

  it('senza il consenso si parla con la voce tolta dal video, chiunque sia', () => {
    expect(mediaDelToken(evento, regola, 'moderatore', false)).toEqual({ ...base, voiceExcluded: true });
    expect(mediaDelToken(evento, regola, 'relatore', false)).toEqual({
      ...base,
      mediaExempt: true,
      voiceExcluded: true,
    });
    expect(mediaDelToken(evento, regola, 'partecipante', false)).toEqual({
      ...base,
      voiceExcluded: true,
      mediaAdmit: { audio: true, video: false, desktop: false },
    });
  });

  it('videocamera e schermo restano chiusi anche se l\'evento li concede', () => {
    const aperto = { ...evento, participantsCanStartVideo: true, participantsCanShareScreen: true };
    const media = mediaDelToken(aperto, regolaConsenso(aperto, true, 'rimovibile'), 'partecipante', false);
    expect(media.mediaAdmit).toEqual({ audio: true, video: false, desktop: false });
  });

  it('dove la voce non si puo\' togliere il pubblico resta in solo ascolto, chi conduce no', () => {
    const r = regolaConsenso(evento, true, 'fissa');
    expect(mediaDelToken(evento, r, 'partecipante', false)).toEqual({ ...base, listenOnly: true });
    expect(mediaDelToken(evento, r, 'moderatore', false)).toEqual(base);
  });

  it('senza registrazione restano i limiti dell\'evento', () => {
    const r = regolaConsenso(evento, false, 'rimovibile');
    expect(mediaDelToken(evento, r, 'partecipante', false)).toEqual({
      mediaLock: { audio: false, video: true, desktop: true },
    });
    expect(mediaDelToken(evento, r, 'relatore', false)).toEqual({
      mediaLock: { audio: false, video: true, desktop: true },
      mediaExempt: true,
    });
  });
});
