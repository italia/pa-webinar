import { describe, expect, it } from 'vitest';

import { buildPipelineSnapshot } from './pipeline-snapshot';

/** Shape projection for assertions (buildPipelineSnapshot returns a loose
 *  Record<string, unknown>; we narrow it here for typed access in tests). */
interface SnapShape {
  asr: { model: string };
  diarization: { engine: string };
  llm: { model: string | null };
  tts: { engine: string } | null;
  watermark: string[] | null;
  languages: { source: string; translation: string[]; dubbing: string[] };
  speakers: Array<{ displayName: string | null }>;
  runAt: string;
}

describe('buildPipelineSnapshot', () => {
  const runAt = '2026-06-11T08:00:00.000Z';

  it('derives engines/models/languages/watermark from artifacts', () => {
    const snap = buildPipelineSnapshot(
      [
        { type: 'TRANSCRIPT_JSON', language: null, modelId: 'large-v3', modelVersion: 'whisperx-3.1', watermarkType: null },
        { type: 'SUMMARY_JSON', language: 'it', modelId: 'mistral-small', modelVersion: null, watermarkType: null },
        { type: 'TRANSLATION_VTT', language: 'en', modelId: 'mistral-small', modelVersion: null, watermarkType: null },
        { type: 'TRANSLATION_VTT', language: 'fr', modelId: 'mistral-small', modelVersion: null, watermarkType: null },
        { type: 'DUBBED_AUDIO', language: 'en', modelId: 'piper:en_US-lessac', modelVersion: 'piper-1.2', watermarkType: 'audioseal' },
        { type: 'DUBBED_AUDIO', language: 'fr', modelId: 'piper:fr_FR-tom', modelVersion: 'piper-1.2', watermarkType: 'audioseal' },
      ],
      [{ diarLabel: 'SPEAKER_00', displayName: 'Paolo', totalSpeechSec: 120 }],
      'it',
      runAt,
    ) as unknown as SnapShape;

    expect(snap.asr.model).toBe('large-v3');
    expect(snap.diarization.engine).toBe('pyannote.audio');
    expect(snap.llm.model).toBe('mistral-small');
    expect(snap.tts?.engine).toBe('piper');
    expect(snap.watermark).toEqual(['audioseal']);
    expect(snap.languages).toEqual({ source: 'it', translation: ['en', 'fr'], dubbing: ['en', 'fr'] });
    expect(snap.speakers).toHaveLength(1);
    expect(snap.speakers[0]?.displayName).toBe('Paolo');
    expect(snap.runAt).toBe(runAt);
  });

  it('flags multitrack diarization and null tts when no dub', () => {
    const snap = buildPipelineSnapshot(
      [{ type: 'TRANSCRIPT_JSON', language: null, modelId: 'multitrack', modelVersion: null, watermarkType: null }],
      [],
      'it',
      runAt,
    ) as unknown as SnapShape;
    expect(snap.diarization.engine).toBe('multitrack-recorder');
    expect(snap.tts).toBeNull();
    expect(snap.watermark).toBeNull();
    expect(snap.languages.translation).toEqual([]);
  });
});
