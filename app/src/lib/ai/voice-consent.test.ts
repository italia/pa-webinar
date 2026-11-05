// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chiedeConsensoPerVoce,
  confermaVociNecessaria,
  leggiCorpoAvvio,
  regimeConsensoVoce,
} from './voice-consent';

const base = {
  multitrackRecordingEnabled: false,
  captionsTranscriptEnabled: false,
  liveCaptionsEnabled: true,
};
// L'evento trascrive il video con la pipeline AI, senza tracce ne' sottotitoli.
const video = { ...base, recordingEnabled: true, aiTranscriptEnabled: true };
const pipeline = { aiPipelineEnabled: true };

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

  describe('con la trascrizione dal video', () => {
    // Senza variabili e' un Jitsi esterno: non si sa chi registra, e la risposta
    // e' quella prudente.
    const installazione = (env: Record<string, string> = {}) => {
      for (const nome of [
        'JITSI_WEB_INTERNAL_URL',
        'JIBRI_HEALTH_URL',
        'RECORDER_CONTROLLER_URL',
        'RECORDING_STORAGE_TYPE',
        'RECORDING_VOICE_EXCLUSION',
      ]) {
        vi.stubEnv(nome, env[nome] ?? '');
      }
    };

    it('vale con registrazione, AI e pipeline accese', () => {
      installazione();
      expect(chiedeConsensoPerVoce(video, pipeline)).toBe(true);
      installazione({ RECORDING_VOICE_EXCLUSION: 'true' });
      expect(chiedeConsensoPerVoce(video, pipeline)).toBe(true);
    });

    it('non vale se manca una delle condizioni', () => {
      installazione();
      expect(chiedeConsensoPerVoce(video, {})).toBe(false);
      expect(chiedeConsensoPerVoce(video, { aiPipelineEnabled: false })).toBe(false);
      expect(chiedeConsensoPerVoce({ ...video, aiTranscriptEnabled: false }, pipeline)).toBe(false);
      expect(chiedeConsensoPerVoce({ ...video, recordingEnabled: false }, pipeline)).toBe(false);
    });

    it('non vale in una chiamata rapida', () => {
      installazione();
      expect(chiedeConsensoPerVoce({ ...video, eventType: 'INSTANT' }, pipeline)).toBe(false);
    });

    it("segue l'installazione: serve un video completo", () => {
      // Il Jitsi del chart senza niente che registri.
      installazione({ JITSI_WEB_INTERNAL_URL: 'http://jitsi' });
      expect(chiedeConsensoPerVoce(video, pipeline)).toBe(false);
      // Solo il registratore per persona: le tracce ci sono, il video no.
      installazione({
        JITSI_WEB_INTERNAL_URL: 'http://jitsi',
        RECORDER_CONTROLLER_URL: 'http://controller',
      });
      expect(chiedeConsensoPerVoce(video, pipeline)).toBe(false);
      installazione({
        JITSI_WEB_INTERNAL_URL: 'http://jitsi',
        JIBRI_HEALTH_URL: 'http://jibri',
      });
      expect(chiedeConsensoPerVoce(video, pipeline)).toBe(true);
    });
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
        {},
        false
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
        {},
        false
      )
    ).toEqual({
      chiesto: true,
      versione: 2,
    });
  });

  it("dopo l'evento le tracce lasciate in sala tengono la regola, anche a interruttori spenti", async () => {
    expect(await regimeConsensoVoce(db({ frase: true }), 'e', base, {}, false)).toEqual({
      chiesto: true,
      versione: 2,
    });
    expect(await regimeConsensoVoce(db({ prova: true }), 'e', base, {}, false)).toEqual({
      chiesto: true,
      versione: 1,
    });
    expect(await regimeConsensoVoce(db({ traccia: true }), 'e', base, {}, false)).toEqual({
      chiesto: true,
      versione: 1,
    });
  });

  it("senza regola ne' tracce non e' stato chiesto", async () => {
    expect(await regimeConsensoVoce(db({}), 'e', base, {}, false)).toEqual({
      chiesto: false,
      versione: 1,
    });
  });

  it('una registrazione senza segno non segue la regola sul video', async () => {
    // La stessa configurazione fa chiedere il consenso a chi entra.
    vi.stubEnv('JITSI_WEB_INTERNAL_URL', '');
    expect(chiedeConsensoPerVoce(video, pipeline)).toBe(true);
    expect(await regimeConsensoVoce(db({}), 'e', video, pipeline, false)).toEqual({
      chiesto: false,
      versione: 1,
    });
  });

  it('una registrazione con il segno conta come consenso chiesto', async () => {
    expect(await regimeConsensoVoce(db({}), 'e', base, {}, true)).toEqual({
      chiesto: true,
      versione: 1,
    });
  });

  it('il segno non cambia il testo che vale con i sottotitoli', async () => {
    expect(await regimeConsensoVoce(db({ frase: true }), 'e', base, {}, true)).toEqual({
      chiesto: true,
      versione: 2,
    });
  });
});

describe('confermaVociNecessaria', () => {
  const db = {
    captionSegment: { findFirst: vi.fn(async () => null) },
    multitrackConsent: { findFirst: vi.fn(async () => null) },
    recordingTrack: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
  } as never;
  const rec = { id: 'r', blobKey: 'recordings/e/a.mp4', eventId: 'e' };

  it('il video di un evento con la sola AI non chiede la conferma', async () => {
    await expect(confermaVociNecessaria(db, rec, video, pipeline)).resolves.toBe(false);
  });

  it('il video di un evento che chiede il consenso voce per voce la chiede', async () => {
    await expect(
      confermaVociNecessaria(db, rec, { ...base, multitrackRecordingEnabled: true }, {})
    ).resolves.toBe(true);
  });

  it("non la chiedono le tracce per persona ne' una registrazione senza file", async () => {
    const e = { ...base, multitrackRecordingEnabled: true };
    await expect(confermaVociNecessaria(db, rec, e, {}, true)).resolves.toBe(false);
    await expect(confermaVociNecessaria(db, { ...rec, blobKey: '' }, e, {})).resolves.toBe(false);
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
