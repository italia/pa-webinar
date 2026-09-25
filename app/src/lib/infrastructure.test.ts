// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  jibriRecordingExpected,
  recordingStorageConfigured,
  recordingStorageLabel,
} from './infrastructure';

/**
 * Lo storage delle registrazioni visto dalle pagine di amministrazione: il
 * «configurato» e il nome mostrato accanto seguono la stessa regola della
 * factory (lib/storage/provider-type), e non si contraddicono.
 */
describe('storage delle registrazioni', () => {
  it('tipo dichiarato e riconosciuto: configurato, col nome dichiarato', () => {
    const env = { RECORDING_STORAGE_TYPE: 'minio' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(recordingStorageLabel(env)).toBe('minio');
    expect(recordingStorageLabel({ RECORDING_STORAGE_TYPE: 'azure-blob' })).toBe('azure-blob');
  });

  it('solo credenziali: configurato, col fornitore rilevato', () => {
    const s3 = { RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(s3)).toBe(true);
    expect(recordingStorageLabel(s3)).toBe('s3');

    const azure = { RECORDING_AZURE_CONNECTION_STRING: 'AccountName=x;AccountKey=y' };
    expect(recordingStorageConfigured(azure)).toBe(true);
    expect(recordingStorageLabel(azure)).toBe('azure');
  });

  it('tipo non riconosciuto ma credenziali presenti: vale il fornitore rilevato', () => {
    const env = { RECORDING_STORAGE_TYPE: 'bucket', RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(recordingStorageLabel(env)).toBe('s3');
  });

  it('niente storage: non configurato', () => {
    expect(recordingStorageConfigured({})).toBe(false);
    expect(recordingStorageLabel({})).toBe('not-configured');
    // `local` non è un fornitore delle registrazioni: resta scritto com'è.
    expect(recordingStorageConfigured({ RECORDING_STORAGE_TYPE: 'local' })).toBe(false);
    expect(recordingStorageLabel({ RECORDING_STORAGE_TYPE: 'local' })).toBe('local');
  });
});

/**
 * Quando l'installazione si aspetta Jibri. Solo lo storage dichiarato: le sole
 * credenziali servono anche al registratore per partecipante su installazioni
 * senza Jibri, dove un'API di salute che non risponde non è un registratore in
 * avvio.
 */
describe('jibriRecordingExpected', () => {
  it('storage dichiarato e risolto: Jibri previsto', () => {
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'azure-blob' })).toBe(true);
    expect(
      jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'bucket', RECORDING_S3_BUCKET: 'reg' }),
    ).toBe(true);
  });

  it('solo credenziali: storage configurato, Jibri non previsto', () => {
    const env = { RECORDING_S3_BUCKET: 'registrazioni' };
    expect(recordingStorageConfigured(env)).toBe(true);
    expect(jibriRecordingExpected(env)).toBe(false);
    expect(
      jibriRecordingExpected({ RECORDING_AZURE_CONNECTION_STRING: 'AccountName=x;AccountKey=y' }),
    ).toBe(false);
  });

  it('niente storage, o `local`: Jibri non previsto', () => {
    expect(jibriRecordingExpected({})).toBe(false);
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'local', RECORDING_S3_BUCKET: 'r' })).toBe(
      false,
    );
    // Un tipo che la factory non risolve, senza credenziali: nulla da registrare.
    expect(jibriRecordingExpected({ RECORDING_STORAGE_TYPE: 'bucket' })).toBe(false);
  });
});
