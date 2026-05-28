import { describe, expect, it } from 'vitest';

import { deriveIdempotencyKey } from './idempotency';

describe('deriveIdempotencyKey', () => {
  it('is deterministic across calls with identical inputs', () => {
    const inputs = {
      recordingId: '7c1f3a8e-1d2b-4d3a-9c4e-5b6f7a8c9d0e',
      kind: 'TRANSCRIBE' as const,
      runCount: 1,
      payload: { sourceLanguage: 'it', model: 'large-v3' },
    };
    const a = deriveIdempotencyKey(inputs);
    const b = deriveIdempotencyKey(inputs);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  it('is stable under key reordering inside payload (canonical stringify)', () => {
    const base = {
      recordingId: 'r',
      kind: 'SUMMARIZE' as const,
      runCount: 2,
      payload: { sourceLanguage: 'it', model: 'qwen' },
    };
    const reordered = {
      ...base,
      payload: { model: 'qwen', sourceLanguage: 'it' },
    };
    expect(deriveIdempotencyKey(base)).toBe(deriveIdempotencyKey(reordered));
  });

  it('changes when runCount changes (so retries don\'t collide)', () => {
    const a = deriveIdempotencyKey({
      recordingId: 'r',
      kind: 'TRANSCRIBE',
      runCount: 1,
      payload: { sourceLanguage: 'it' },
    });
    const b = deriveIdempotencyKey({
      recordingId: 'r',
      kind: 'TRANSCRIBE',
      runCount: 2,
      payload: { sourceLanguage: 'it' },
    });
    expect(a).not.toBe(b);
  });

  it('changes when payload nested values change', () => {
    const a = deriveIdempotencyKey({
      recordingId: 'r',
      kind: 'TRANSLATE',
      runCount: 1,
      payload: {
        sourceLanguage: 'it',
        targetLanguage: 'en',
        transcriptArtifactId: 'a1',
      },
    });
    const b = deriveIdempotencyKey({
      recordingId: 'r',
      kind: 'TRANSLATE',
      runCount: 1,
      payload: {
        sourceLanguage: 'it',
        targetLanguage: 'fr',
        transcriptArtifactId: 'a1',
      },
    });
    expect(a).not.toBe(b);
  });

  it('changes across recording ids even with identical other fields', () => {
    const args = {
      kind: 'TRANSCRIBE' as const,
      runCount: 1,
      payload: { sourceLanguage: 'it' },
    };
    const a = deriveIdempotencyKey({ ...args, recordingId: 'r1' });
    const b = deriveIdempotencyKey({ ...args, recordingId: 'r2' });
    expect(a).not.toBe(b);
  });
});
