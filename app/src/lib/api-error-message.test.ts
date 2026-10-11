import { describe, expect, it } from 'vitest';

import { codiceErrore, messaggioErroreApi } from './api-error-message';

const t = (k: string) => `[${k}]`;

describe('messaggioErroreApi', () => {
  it('traduce gli stati noti e lascia il ripiego per gli altri', () => {
    expect(messaggioErroreApi(429, t, 'ripiego')).toBe('[rateLimited]');
    expect(messaggioErroreApi(404, t, 'ripiego')).toBe('[notFound]');
    expect(messaggioErroreApi(422, t, 'ripiego')).toBe('ripiego');
    expect(messaggioErroreApi(500, t, 'ripiego')).toBe('ripiego');
  });

  it('un 409 senza un caso proprio non diventa «ricarica e riprova»', () => {
    expect(messaggioErroreApi(409, t, 'ripiego')).toBe('ripiego');
  });

  it('i casi propri della schermata vincono sullo stato', () => {
    expect(messaggioErroreApi(409, t, 'ripiego', { 409: 'chiuso' })).toBe('chiuso');
  });

  it('un codice noto dice la condizione precisa, anche contro i casi propri', () => {
    expect(messaggioErroreApi(422, t, 'ripiego', {}, 'AI_PIPELINE_DISABLED')).toBe('[aiPipelineDisabled]');
    expect(messaggioErroreApi(409, t, 'ripiego', { 409: 'chiuso' }, 'TRANSCRIPT_CORRECTED')).toBe(
      '[transcriptCorrected]',
    );
    expect(messaggioErroreApi(503, t, 'ripiego', {}, 'STORAGE_UNAVAILABLE')).toBe('[storageUnavailable]');
  });

  it('un codice generico o sconosciuto non cambia niente', () => {
    expect(messaggioErroreApi(422, t, 'ripiego', {}, 'VALIDATION_ERROR')).toBe('ripiego');
    expect(messaggioErroreApi(404, t, 'ripiego', {}, 'toString')).toBe('[notFound]');
  });
});

describe('codiceErrore', () => {
  it('legge il codice dal corpo, e null se non c\'e\' o non e\' JSON', async () => {
    expect(await codiceErrore(new Response(JSON.stringify({ code: 'X' })))).toBe('X');
    expect(await codiceErrore(new Response(JSON.stringify({ error: 'x' })))).toBeNull();
    expect(await codiceErrore(new Response('<html>'))).toBeNull();
  });
});
