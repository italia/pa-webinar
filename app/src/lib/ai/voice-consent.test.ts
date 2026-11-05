import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chiedeConsensoPerVoce,
  leggiCorpoAvvio,
  regimeConsensoVoce,
} from './voice-consent';

const base = {
  multitrackRecordingEnabled: false,
  captionsTranscriptEnabled: false,
  liveCaptionsEnabled: true,
};

describe('chiedeConsensoPerVoce', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('vale con la traccia per persona', () => {
    expect(chiedeConsensoPerVoce({ ...base, multitrackRecordingEnabled: true }, {})).toBe(
      true
    );
  });

  it('per la trascrizione dai sottotitoli serve che i sottotitoli ci siano davvero', () => {
    const e = { ...base, captionsTranscriptEnabled: true };
    expect(chiedeConsensoPerVoce(e, {})).toBe(false);
    vi.stubEnv('CAPTIONS_STATUS_URL', 'http://captions/status');
    expect(chiedeConsensoPerVoce(e, {})).toBe(true);
    expect(chiedeConsensoPerVoce(e, { liveCaptionsEnabled: false })).toBe(false);
    expect(chiedeConsensoPerVoce({ ...e, liveCaptionsEnabled: false }, {})).toBe(false);
  });

  it('non vale per un evento che registra solo il video della sala', () => {
    expect(chiedeConsensoPerVoce(base, {})).toBe(false);
  });
});

describe('regimeConsensoVoce', () => {
  afterEach(() => vi.unstubAllEnvs());
  const db = (tracce: { frase?: boolean; prova?: boolean; traccia?: boolean }) =>
    ({
      captionSegment: {
        findFirst: vi.fn(async () => (tracce.frase ? { id: 'f' } : null)),
      },
      multitrackConsent: {
        findFirst: vi.fn(async () => (tracce.prova ? { id: 'p' } : null)),
      },
      recordingTrack: {
        findFirst: vi.fn(async () => (tracce.traccia ? { id: 't' } : null)),
      },
    }) as never;

  it('con la sola traccia audio vale ogni versione del testo', async () => {
    expect(
      await regimeConsensoVoce(
        db({}),
        'e',
        { ...base, multitrackRecordingEnabled: true },
        {}
      )
    ).toEqual({
      chiesto: true,
      versione: 1,
    });
  });

  it('con la trascrizione dai sottotitoli attiva vale il testo con il nome', async () => {
    vi.stubEnv('CAPTIONS_STATUS_URL', 'http://captions/status');
    expect(
      await regimeConsensoVoce(
        db({}),
        'e',
        { ...base, captionsTranscriptEnabled: true },
        {}
      )
    ).toEqual({
      chiesto: true,
      versione: 2,
    });
  });

  it("dopo l'evento le tracce lasciate in sala tengono la regola, anche a interruttori spenti", async () => {
    expect(await regimeConsensoVoce(db({ frase: true }), 'e', base, {})).toEqual({
      chiesto: true,
      versione: 2,
    });
    expect(await regimeConsensoVoce(db({ prova: true }), 'e', base, {})).toEqual({
      chiesto: true,
      versione: 1,
    });
    expect(await regimeConsensoVoce(db({ traccia: true }), 'e', base, {})).toEqual({
      chiesto: true,
      versione: 1,
    });
  });

  it("senza regola ne' tracce non e' stato chiesto", async () => {
    expect(await regimeConsensoVoce(db({}), 'e', base, {})).toEqual({
      chiesto: false,
      versione: 1,
    });
  });
});

describe('leggiCorpoAvvio', () => {
  const req = (body?: string) => new Request('http://x', { method: 'POST', body });

  it('un corpo assente vale come vuoto', async () => {
    await expect(leggiCorpoAvvio(req())).resolves.toEqual({
      summary: false,
      translation: false,
    });
  });

  it('accetta i campi noti', async () => {
    await expect(
      leggiCorpoAvvio(req(JSON.stringify({ summary: true, allVoicesConsented: true })))
    ).resolves.toEqual({ summary: true, translation: false, allVoicesConsented: true });
  });

  it("ignora i campi in piu' e un corpo che non e' JSON, come prima", async () => {
    await expect(
      leggiCorpoAvvio(req(JSON.stringify({ summary: true, source: 'script' })))
    ).resolves.toEqual({
      summary: true,
      translation: false,
    });
    // Un valore che non e' `true` non accende niente, senza errore.
    await expect(
      leggiCorpoAvvio(req(JSON.stringify({ summary: 'true' })))
    ).resolves.toEqual({
      summary: false,
      translation: false,
    });
    await expect(leggiCorpoAvvio(req('{'))).resolves.toEqual({
      summary: false,
      translation: false,
    });
  });

  it("rifiuta una conferma che non e' un booleano", async () => {
    await expect(
      leggiCorpoAvvio(req(JSON.stringify({ allVoicesConsented: 'true' })))
    ).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});
