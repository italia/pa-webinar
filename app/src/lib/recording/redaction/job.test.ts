// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { describe, expect, it, vi } from 'vitest';

import { redactPayloadSchema } from '@/lib/ai/schemas';

import { runDellaChiave } from './apply';
import { accodaRimozione, chiaveVideoRipulito, linguaDelCartello } from './job';

const E = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const Q = '33333333-3333-4333-8333-333333333333';

describe('il lavoro di rimozione', () => {
  it('il video ripulito va accanto agli altri video, mai sopra l’originale', () => {
    expect(chiaveVideoRipulito(E, R, Q)).toBe(`recordings/redacted/${E}/${R}/${Q}.mp4`);
  });

  it('il cartello parla la lingua della registrazione, se l’interfaccia la conosce', () => {
    expect(linguaDelCartello('de')).toBe('de');
    expect(linguaDelCartello('EN-gb')).toBe('en');
    expect(linguaDelCartello('ja')).toBe('it');
    expect(linguaDelCartello(null)).toBe('it');
  });

  it('accoda un lavoro dell’evento con un payload valido', async () => {
    const crea = vi.fn(async (_: unknown) => ({ id: 'job' }));
    const tx = { postprodJob: { create: crea } } as never;
    const id = await accodaRimozione(
      tx,
      { id: Q, eventId: E },
      { id: R, blobKey: 'recordings/sala.mp4', sourceLanguage: 'fr' },
      [{ start: 1, end: 2 }]
    );
    expect(id).toBe('job');
    const { data } = crea.mock.calls[0]![0] as {
      data: { eventId: string; kind: string; payload: unknown; idempotencyKey: string };
    };
    expect(data).toMatchObject({ eventId: E, kind: 'REDACT' });
    expect(data.idempotencyKey.startsWith(`redact:${Q}:`)).toBe(true);
    expect(redactPayloadSchema.parse(data.payload)).toEqual({
      eventId: E,
      recordingId: R,
      requestId: Q,
      sourceKey: 'recordings/sala.mp4',
      targetKey: chiaveVideoRipulito(E, R, Q),
      intervals: [{ start: 1, end: 2 }],
      language: 'fr',
    });
  });

  it('il payload rifiuta una destinazione fuori dalla cartella dei video ripuliti', () => {
    expect(
      redactPayloadSchema.safeParse({
        eventId: E,
        recordingId: R,
        requestId: Q,
        sourceKey: 'recordings/sala.mp4',
        targetKey: 'recordings/sala.mp4',
        intervals: [{ start: 1, end: 2 }],
        language: 'it',
      }).success
    ).toBe(false);
  });

  it('la run di un file della post-produzione', () => {
    expect(runDellaChiave('postprod/e/r', 'postprod/e/r/002/transcript.raw.json')).toBe(
      2
    );
    expect(runDellaChiave('postprod/e/r', 'postprod/e/r2/001/x')).toBeNull();
    expect(runDellaChiave('postprod/e/r', 'postprod/e/r/strano/x')).toBeNull();
  });
});
