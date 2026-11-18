// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  eventoRegistrabile,
  partecipantiNelVideo,
  recordingAvailable,
  recordingAvailableFor,
  tracceDisponibili,
  voceNelVideo,
} from './availability';

// Jitsi installato dal chart: l'unico caso in cui l'assenza di un registratore
// e' certa.
const CHART = { JITSI_WEB_INTERNAL_URL: 'http://pa-webinar-jitsi-meet-web' };

describe('recordingAvailable', () => {
  it('Jitsi esterno o non dichiarato: si presume che possa registrare', () => {
    expect(recordingAvailable({})).toBe(true);
    expect(recordingAvailable({ RECORDING_STORAGE_TYPE: 'local' })).toBe(true);
  });

  it('chart senza Jibri e senza registratore per partecipante: non si registra', () => {
    expect(recordingAvailable(CHART)).toBe(false);
  });

  it('solo le credenziali dello storage non bastano (servono anche ai caricamenti manuali)', () => {
    expect(recordingAvailable({ ...CHART, RECORDING_S3_BUCKET: 'registrazioni' })).toBe(false);
  });

  it('storage «local» e nessun Jibri reso dal chart: non si registra', () => {
    expect(recordingAvailable({ ...CHART, RECORDING_STORAGE_TYPE: 'local' })).toBe(false);
  });

  it('Jibri atteso (storage dichiarato e risolvibile): si registra', () => {
    expect(recordingAvailable({ ...CHART, RECORDING_STORAGE_TYPE: 'minio' })).toBe(true);
  });

  it('Jibri acceso dal chart anche senza storage dichiarato: si registra', () => {
    expect(
      recordingAvailable({ ...CHART, JIBRI_HEALTH_URL: 'http://pa-webinar-jitsi-meet-jibri:2222' }),
    ).toBe(true);
  });

  it('registratore per partecipante collegato: si registra anche senza Jibri', () => {
    expect(
      recordingAvailable({ ...CHART, RECORDER_CONTROLLER_URL: 'http://recorder-controller:8080' }),
    ).toBe(true);
  });

  it('un indirizzo vuoto del registratore non conta', () => {
    expect(recordingAvailable({ ...CHART, RECORDER_CONTROLLER_URL: '  ' })).toBe(false);
  });
});

describe('voceNelVideo', () => {
  const chart = { JITSI_WEB_INTERNAL_URL: 'http://jitsi-web' };

  it('lo dichiara il chart, con il testo del registratore', () => {
    expect(voceNelVideo({ ...chart, JIBRI_HEALTH_URL: 'http://jibri', RECORDING_VOICE_EXCLUSION: 'true' })).toBe(
      'rimovibile',
    );
  });

  it('con Jibri senza quel testo la voce resta nel video', () => {
    expect(voceNelVideo({ ...chart, JIBRI_HEALTH_URL: 'http://jibri' })).toBe('fissa');
  });

  it('senza Jibri non c\'e\' un video completo', () => {
    expect(voceNelVideo({ ...chart, RECORDER_CONTROLLER_URL: 'http://registratore' })).toBe('assente');
  });

  it('con un Jitsi esterno non si sa chi registra: vale la risposta prudente', () => {
    expect(voceNelVideo({})).toBe('fissa');
  });
});

describe('partecipantiNelVideo', () => {
  const conJibri = { JITSI_WEB_INTERNAL_URL: 'http://jitsi-web', JIBRI_HEALTH_URL: 'http://jibri' };

  it('il testo del chart riproduce la voce dei partecipanti: solo voce', () => {
    expect(
      partecipantiNelVideo({
        ...conJibri,
        RECORDING_VOICE_EXCLUSION: 'true',
        RECORDING_PARTICIPANT_VOICE: 'true',
      }),
    ).toBe('solo-voce');
  });

  it('il testo onora i segni ma non riproduce la voce: fuori anche la voce', () => {
    expect(partecipantiNelVideo({ ...conJibri, RECORDING_VOICE_EXCLUSION: 'true' })).toBe('esclusi');
  });

  it('la voce dichiarata senza la funzione nascosta non basta: i segni non valgono', () => {
    expect(partecipantiNelVideo({ ...conJibri, RECORDING_PARTICIPANT_VOICE: 'true' })).toBe('visibili');
  });

  it('con un Jitsi esterno non si sa cosa mostra il registratore: possono comparire', () => {
    expect(partecipantiNelVideo({})).toBe('visibili');
  });

  it('fuori dal chart valgono le variabili dichiarate a mano (Docker Compose con un Jibri suo)', () => {
    expect(
      partecipantiNelVideo({ RECORDING_VOICE_EXCLUSION: 'true', RECORDING_PARTICIPANT_VOICE: 'true' }),
    ).toBe('solo-voce');
  });

  it('senza Jibri non c\'e\' un video completo', () => {
    expect(
      partecipantiNelVideo({
        JITSI_WEB_INTERNAL_URL: 'http://jitsi-web',
        RECORDER_CONTROLLER_URL: 'http://registratore',
        RECORDING_PARTICIPANT_VOICE: 'true',
      }),
    ).toBe('assente');
  });

  it('un valore diverso da «true» non dichiara niente', () => {
    expect(
      partecipantiNelVideo({ ...conJibri, RECORDING_VOICE_EXCLUSION: 'true', RECORDING_PARTICIPANT_VOICE: '1' }),
    ).toBe('esclusi');
  });
});

describe('tracceDisponibili', () => {
  it('Jitsi esterno o non dichiarato: si presume che il registratore ci sia', () => {
    expect(tracceDisponibili({})).toBe(true);
  });

  it('chart con il registratore per partecipante collegato', () => {
    expect(tracceDisponibili({ ...CHART, RECORDER_CONTROLLER_URL: 'http://recorder-controller:8080' })).toBe(
      true,
    );
  });

  it('il solo Jibri registra il video ma non le tracce', () => {
    const soloJibri = { ...CHART, JIBRI_HEALTH_URL: 'http://pa-webinar-jitsi-meet-jibri:2222' };
    expect(recordingAvailable(soloJibri)).toBe(true);
    expect(tracceDisponibili(soloJibri)).toBe(false);
  });

  it('un indirizzo vuoto del registratore non conta', () => {
    expect(tracceDisponibili({ ...CHART, RECORDER_CONTROLLER_URL: '  ' })).toBe(false);
  });
});

describe('eventoRegistrabile', () => {
  const CON_TRACCE = {
    recordingEnabled: true,
    aiTranscriptEnabled: true,
    multitrackRecordingEnabled: true,
  };
  const SENZA_TRACCE = { ...CON_TRACCE, multitrackRecordingEnabled: false };
  const ambiente = {
    registrazioneDisponibile: true,
    voce: 'assente' as const,
    tracceDisponibili: true,
  };

  it('senza video e senza tracce non si registra niente', () => {
    expect(eventoRegistrabile(SENZA_TRACCE, ambiente)).toBe(false);
    expect(eventoRegistrabile({ ...CON_TRACCE, aiTranscriptEnabled: false }, ambiente)).toBe(false);
    expect(eventoRegistrabile(CON_TRACCE, { ...ambiente, tracceDisponibili: false })).toBe(false);
  });

  it('senza video le tracce bastano', () => {
    expect(eventoRegistrabile(CON_TRACCE, ambiente)).toBe(true);
  });

  it.each(['rimovibile', 'fissa'] as const)('con un video (%s) non servono le tracce', (voce) => {
    expect(eventoRegistrabile(SENZA_TRACCE, { ...ambiente, voce })).toBe(true);
  });

  it("senza nulla che registri non basta l'evento", () => {
    expect(
      eventoRegistrabile(CON_TRACCE, { ...ambiente, registrazioneDisponibile: false }),
    ).toBe(false);
  });

  it("recordingAvailableFor legge l'ambiente", () => {
    const soloRegistratore = { ...CHART, RECORDER_CONTROLLER_URL: 'http://recorder' };
    expect(recordingAvailableFor(SENZA_TRACCE, soloRegistratore)).toBe(false);
    expect(recordingAvailableFor(CON_TRACCE, soloRegistratore)).toBe(true);
    expect(recordingAvailableFor(SENZA_TRACCE, {})).toBe(true);
  });
});
