import { describe, expect, it } from 'vitest';

import {
  artifactRegisterSchema,
  claimResponseSchema,
  postprodJobPayloadSchema,
  progressPayloadSchema,
} from './schemas';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('postprodJobPayloadSchema (discriminated) — DUB', () => {
  it('accepts a valid DUB payload', () => {
    const ok = postprodJobPayloadSchema.parse({
      kind: 'DUB',
      payload: {
        runId: UUID,
        sourceLanguage: 'it',
        targetLanguage: 'en',
        translatedTranscriptArtifactId: UUID,
      },
    });
    if (ok.kind !== 'DUB') throw new Error('narrowing failed');
    expect(ok.payload.targetLanguage).toBe('en');
  });

  it('rejects DUB without targetLanguage', () => {
    expect(() =>
      postprodJobPayloadSchema.parse({
        kind: 'DUB',
        payload: {
          runId: UUID,
          sourceLanguage: 'it',
          translatedTranscriptArtifactId: UUID,
        },
      }),
    ).toThrow();
  });

  // translatedTranscriptArtifactId è opzionale: il worker lo riceve via
  // claim `inputs` (il TRANSLATION_VTT non esiste all'enqueue, lo produce
  // TRANSLATE). Renderlo required faceva fallire ogni claim DUB con 422.
  it('accepts DUB without translatedTranscriptArtifactId', () => {
    const ok = postprodJobPayloadSchema.parse({
      kind: 'DUB',
      payload: {
        runId: UUID,
        sourceLanguage: 'it',
        targetLanguage: 'en',
      },
    });
    expect(ok.kind).toBe('DUB');
  });

  it('accepts a DUBBED_AUDIO artifact register payload', () => {
    expect(
      artifactRegisterSchema.parse({
        jobId: UUID,
        type: 'DUBBED_AUDIO',
        language: 'en',
        blobKey: 'postprod/ev/rec/001/dubbed.en.m4a',
        sizeBytes: 1024000,
        mimeType: 'audio/mp4',
        contentHash: '0'.repeat(64),
        modelId: 'piper:en_US-lessac-medium',
      }),
    ).toBeTruthy();
  });
});

describe('postprodJobPayloadSchema (discriminated)', () => {
  it('validates a TRANSCRIBE job', () => {
    const ok = postprodJobPayloadSchema.parse({
      kind: 'TRANSCRIBE',
      payload: { runId: UUID, sourceLanguage: 'it' },
    });
    if (ok.kind !== 'TRANSCRIBE') throw new Error('kind narrowing failed');
    expect(ok.payload.sourceLanguage).toBe('it');
  });

  // transcriptArtifactId è opzionale: risolto via claim `inputs`, non noto
  // all'enqueue (che gira prima di TRANSCRIBE). Era required → claim 422.
  it('accepts SUMMARIZE without transcriptArtifactId', () => {
    const ok = postprodJobPayloadSchema.parse({
      kind: 'SUMMARIZE',
      payload: { runId: UUID, sourceLanguage: 'it' },
    });
    expect(ok.kind).toBe('SUMMARIZE');
  });

  it('rejects TRANSLATE missing targetLanguage', () => {
    expect(() =>
      postprodJobPayloadSchema.parse({
        kind: 'TRANSLATE',
        payload: {
          runId: UUID,
          sourceLanguage: 'it',
          transcriptArtifactId: UUID,
        },
      }),
    ).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      postprodJobPayloadSchema.parse({
        kind: 'UNKNOWN',
        payload: { runId: UUID, sourceLanguage: 'it' },
      }),
    ).toThrow();
  });
});

describe('claimResponseSchema (sovereignty)', () => {
  it('only accepts vllm as llmProvider', () => {
    const base = {
      jobId: UUID,
      recordingId: UUID,
      kind: 'TRANSCRIBE',
      payload: {},
      attempts: 1,
      leaseExpiresAt: new Date().toISOString(),
      sourceDownloadUrl: 'https://storage.example/object',
      uploadTargets: {},
      inputs: [],
    };
    const ok = claimResponseSchema.parse({
      ...base,
      providerHints: { llmProvider: 'vllm', asrProvider: 'whisperx' },
    });
    expect(ok.providerHints.llmProvider).toBe('vllm');

    expect(() =>
      claimResponseSchema.parse({
        ...base,
        providerHints: { llmProvider: 'ovh', asrProvider: 'whisperx' },
      }),
    ).toThrow();
  });
});

describe('progressPayloadSchema', () => {
  it('accepts a RUNNING update with optional fields', () => {
    expect(
      progressPayloadSchema.parse({
        jobId: UUID,
        status: 'RUNNING',
        percent: 42,
        message: 'asr stage',
      }).status,
    ).toBe('RUNNING');
  });

  it('caps percent to 0..100', () => {
    expect(() =>
      progressPayloadSchema.parse({
        jobId: UUID,
        status: 'RUNNING',
        percent: 150,
      }),
    ).toThrow();
  });
});

describe('artifactRegisterSchema', () => {
  it('accepts a TRANSCRIPT_VTT artifact in source language', () => {
    expect(
      artifactRegisterSchema.parse({
        jobId: UUID,
        type: 'TRANSCRIPT_VTT',
        language: 'it',
        blobKey: 'postprod/ev/rec/001/transcript.it.vtt',
        sizeBytes: 1234,
        mimeType: 'text/vtt',
        contentHash:
          'a'.repeat(64),
      }),
    ).toBeTruthy();
  });

  it('rejects malformed contentHash', () => {
    expect(() =>
      artifactRegisterSchema.parse({
        jobId: UUID,
        type: 'TRANSCRIPT_VTT',
        language: 'it',
        blobKey: 'k',
        sizeBytes: 1,
        mimeType: 'text/vtt',
        contentHash: 'not-a-sha',
      }),
    ).toThrow();
  });

  it('accepts an artifact with a speakerMap', () => {
    expect(
      artifactRegisterSchema.parse({
        jobId: UUID,
        type: 'TRANSCRIPT_JSON',
        language: null,
        blobKey: 'k',
        sizeBytes: 100,
        mimeType: 'application/json',
        contentHash: 'f'.repeat(64),
        speakerMap: [
          { diarLabel: 'SPEAKER_00', totalSpeechSec: 12 },
          { diarLabel: 'SPEAKER_01', totalSpeechSec: 5 },
        ],
      }),
    ).toBeTruthy();
  });
});
