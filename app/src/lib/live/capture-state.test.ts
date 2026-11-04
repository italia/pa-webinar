import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { catturaDallaRisposta, statoCattura } from './capture-state';

const EVENTO = {
  status: 'LIVE',
  recordingEnabled: true,
  aiTranscriptEnabled: true,
  multitrackRecordingEnabled: true,
  captionsTranscriptEnabled: false,
  liveCaptionsEnabled: true,
};
const SOTTOTITOLI = {
  ...EVENTO,
  multitrackRecordingEnabled: false,
  captionsTranscriptEnabled: true,
};

describe('statoCattura', () => {
  beforeEach(() => vi.stubEnv('CAPTIONS_STATUS_URL', 'http://sottotitoli:2700/status'));
  afterEach(() => vi.unstubAllEnvs());

  it("il registratore per persona conta da quando l'evento e' in diretta", () => {
    expect(statoCattura(EVENTO, {})).toEqual({ registrazione: true, trascrizione: true });
    expect(statoCattura({ ...EVENTO, status: 'PUBLISHED' }, {}).registrazione).toBe(
      false
    );
  });

  it.each([
    'recordingEnabled',
    'aiTranscriptEnabled',
    'multitrackRecordingEnabled',
  ] as const)('senza %s il registratore non parte', (campo) => {
    expect(statoCattura({ ...EVENTO, [campo]: false }, {}).registrazione).toBe(false);
  });

  it("la trascrizione dai sottotitoli vale finche' i sottotitoli sono accesi", () => {
    expect(statoCattura(SOTTOTITOLI, {})).toEqual({
      registrazione: false,
      trascrizione: true,
    });
    expect(
      statoCattura({ ...SOTTOTITOLI, liveCaptionsEnabled: false }, {}).trascrizione
    ).toBe(false);
    expect(statoCattura(SOTTOTITOLI, { liveCaptionsEnabled: false }).trascrizione).toBe(
      false
    );
  });

  it("chi prova prima della diretta e' trascritto lo stesso: si dice anche a lui", () => {
    expect(statoCattura({ ...SOTTOTITOLI, status: 'PUBLISHED' }, {}).trascrizione).toBe(
      true
    );
  });

  it('a evento concluso non si cattura niente', () => {
    expect(statoCattura({ ...SOTTOTITOLI, status: 'ENDED' }, {})).toEqual({
      registrazione: false,
      trascrizione: false,
    });
  });
});

describe('catturaDallaRisposta', () => {
  it('legge lo stato', () => {
    expect(
      catturaDallaRisposta({ capture: { recording: true, transcription: false } })
    ).toEqual({
      registrazione: true,
      trascrizione: false,
    });
  });

  it('una risposta senza lo stato non lo azzera', () => {
    expect(catturaDallaRisposta(null)).toBeNull();
    expect(catturaDallaRisposta({ status: 'LIVE' })).toBeNull();
    expect(catturaDallaRisposta({ capture: { recording: 'si' } })).toBeNull();
  });
});
