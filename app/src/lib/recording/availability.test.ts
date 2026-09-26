// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { recordingAvailable } from './availability';

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
