import { describe, expect, it } from 'vitest';

import {
  computeOverallReliability,
  computeStageReliability,
  computeTranscriptReliability,
  logprobToConfidence,
  type StageArtifactInput,
  type StageJobInput,
} from './reliability';

describe('logprobToConfidence', () => {
  it('maps avg_logprob through exp, clamped to [0,1]', () => {
    expect(logprobToConfidence(0)).toBe(1);
    expect(logprobToConfidence(-1)).toBeCloseTo(Math.exp(-1), 5);
    expect(logprobToConfidence(-0.3)).toBeCloseTo(Math.exp(-0.3), 5);
  });

  it('returns 0 for non-finite input (guards against garbage)', () => {
    expect(logprobToConfidence(NaN)).toBe(0);
    expect(logprobToConfidence(Infinity)).toBe(0);
    expect(logprobToConfidence(-Infinity)).toBe(0);
  });
});

describe('computeTranscriptReliability', () => {
  it('flags an empty transcript (the silent-audio failure) as verdict=empty', () => {
    const r = computeTranscriptReliability({ segments: [], speakers: [] });
    expect(r.verdict).toBe('empty');
    expect(r.segments).toBe(0);
    expect(r.avgConfidencePct).toBeNull();
    expect(r.speechSec).toBe(0);
  });

  it('treats null/undefined transcript as empty', () => {
    expect(computeTranscriptReliability(null).verdict).toBe('empty');
    expect(computeTranscriptReliability(undefined).verdict).toBe('empty');
  });

  it('computes duration-weighted confidence and speech time', () => {
    const r = computeTranscriptReliability({
      segments: [
        { start: 0, end: 10, avg_logprob: -0.1, speaker: 'A' }, // high conf, long
        { start: 10, end: 11, avg_logprob: -2.0, speaker: 'B' }, // low conf, short
      ],
      speakers: [{ diarLabel: 'A' }, { diarLabel: 'B' }],
    });
    expect(r.segments).toBe(2);
    expect(r.speakers).toBe(2);
    expect(r.speechSec).toBe(11);
    // no no_speech_prob on the segments → no silence penalty (factor 1)
    expect(r.avgNoSpeechPct).toBe(0);
    // duration-weighted: (10*exp(-0.1) + 1*exp(-2)) / 11 * 100
    const expected = ((10 * Math.exp(-0.1) + 1 * Math.exp(-2)) / 11) * 100;
    expect(r.avgConfidencePct).toBeCloseTo(expected, 3);
    expect(r.lowConfidenceSegments).toBe(1); // the -2.0 one is < -0.6
    expect(r.verdict).toBe('ok');
  });

  it('penalises confidence by no_speech_prob so silent hallucinations read low', () => {
    // A plausible avg_logprob (-0.2 → ~82% raw) but high no_speech_prob:
    // exp(-0.2) * (1 - 0.55) ≈ 0.37 → below the 40% low-confidence line.
    const r = computeTranscriptReliability({
      segments: [{ start: 0, end: 10, avg_logprob: -0.2, no_speech_prob: 0.55 }],
    });
    const expected = Math.exp(-0.2) * (1 - 0.55) * 100;
    expect(r.avgConfidencePct).toBeCloseTo(expected, 3);
    expect(r.avgNoSpeechPct).toBeCloseTo(55, 3);
    expect(r.verdict).toBe('low');
  });

  it('merges overlapping segments so speechSec never exceeds real time (multi-track cross-talk)', () => {
    // Two speakers talking over each other 0–40s and 20–60s: summed = 80s,
    // but the real speech span is 0–60 = 60s.
    const r = computeTranscriptReliability({
      segments: [
        { start: 0, end: 40, speaker: 'A', avg_logprob: -0.2 },
        { start: 20, end: 60, speaker: 'B', avg_logprob: -0.2 },
      ],
    });
    expect(r.speechSec).toBe(60);
  });

  it('does not count a null/absent speaker as a participant', () => {
    const r = computeTranscriptReliability({
      segments: [
        { start: 0, end: 1, speaker: 'A', avg_logprob: -0.2 },
        { start: 1, end: 2, speaker: 'B', avg_logprob: -0.2 },
        { start: 2, end: 3, speaker: null, avg_logprob: -0.2 },
      ],
    });
    expect(r.speakers).toBe(2);
  });

  it('marks verdict=low when weighted confidence falls under 40%', () => {
    const r = computeTranscriptReliability({
      segments: [
        { start: 0, end: 5, avg_logprob: -1.5 },
        { start: 5, end: 10, avg_logprob: -1.8 },
      ],
    });
    expect(r.avgConfidencePct).not.toBeNull();
    expect(r.avgConfidencePct!).toBeLessThan(40);
    expect(r.verdict).toBe('low');
  });

  it('derives speaker count from segment labels when speakers[] absent', () => {
    const r = computeTranscriptReliability({
      segments: [
        { start: 0, end: 1, speaker: 'X', avg_logprob: -0.2 },
        { start: 1, end: 2, speaker: 'Y', avg_logprob: -0.2 },
        { start: 2, end: 3, speaker: 'X', avg_logprob: -0.2 },
      ],
    });
    expect(r.speakers).toBe(2);
  });

  it('leaves confidence null when no segment has avg_logprob', () => {
    const r = computeTranscriptReliability({
      segments: [{ start: 0, end: 3, text: 'ciao' }],
    });
    expect(r.avgConfidencePct).toBeNull();
    expect(r.verdict).toBe('ok');
  });
});

describe('computeStageReliability', () => {
  const baseArtifact: StageArtifactInput = {
    type: 'TRANSCRIPT_JSON',
    language: 'it',
    modelId: 'large-v3',
    modelVersion: 'whisperx-3.1',
    sizeBytes: 1234,
  };
  const base: StageJobInput = {
    kind: 'TRANSCRIBE_MULTITRACK',
    status: 'DONE',
    startedAt: '2026-07-09T10:00:00.000Z',
    completedAt: '2026-07-09T10:02:30.000Z',
    attempts: 1,
    lastError: null,
    artifacts: [baseArtifact],
  };

  it('computes wall-clock duration and a model label', () => {
    const s = computeStageReliability(base);
    expect(s.durationSec).toBe(150);
    expect(s.model).toBe('large-v3 (whisperx-3.1)');
    expect(s.languages).toEqual(['it']);
    expect(s.artifactCount).toBe(1);
  });

  it('returns null duration when never started or finished', () => {
    expect(computeStageReliability({ ...base, completedAt: null }).durationSec).toBeNull();
    expect(computeStageReliability({ ...base, startedAt: null }).durationSec).toBeNull();
  });

  it('omits version from the label when only modelId is present', () => {
    const s = computeStageReliability({
      ...base,
      artifacts: [{ ...baseArtifact, modelVersion: null }],
    });
    expect(s.model).toBe('large-v3');
  });

  it('leaves model null when no artifact carries a modelId', () => {
    const s = computeStageReliability({
      ...base,
      artifacts: [{ ...baseArtifact, modelId: null }],
    });
    expect(s.model).toBeNull();
  });
});

describe('computeOverallReliability', () => {
  it('scores an empty transcript as 0 / failed with a transcriptEmpty error', () => {
    const transcript = computeTranscriptReliability({ segments: [] });
    const overall = computeOverallReliability([], transcript);
    expect(overall.scorePct).toBe(0);
    expect(overall.level).toBe('failed');
    expect(overall.warnings.some((w) => w.code === 'transcriptEmpty' && w.severity === 'error')).toBe(
      true,
    );
  });

  it('reports good level and total processing time for a healthy run', () => {
    const transcript = computeTranscriptReliability({
      segments: [{ start: 0, end: 60, avg_logprob: -0.1 }],
    });
    const stages = [
      computeStageReliability({
        kind: 'TRANSCRIBE_MULTITRACK',
        status: 'DONE',
        startedAt: '2026-07-09T10:00:00.000Z',
        completedAt: '2026-07-09T10:00:40.000Z',
        attempts: 1,
        lastError: null,
        artifacts: [],
      }),
      computeStageReliability({
        kind: 'SUMMARIZE',
        status: 'DONE',
        startedAt: '2026-07-09T10:01:00.000Z',
        completedAt: '2026-07-09T10:01:20.000Z',
        attempts: 1,
        lastError: null,
        artifacts: [],
      }),
    ];
    const overall = computeOverallReliability(stages, transcript);
    expect(overall.totalProcessingSec).toBe(60);
    expect(overall.scorePct).not.toBeNull();
    expect(overall.scorePct!).toBeGreaterThan(75);
    expect(overall.level).toBe('good');
    expect(overall.warnings).toHaveLength(0);
  });

  it('emits stageFailed (error) and marks the run failed', () => {
    const transcript = computeTranscriptReliability({
      segments: [{ start: 0, end: 10, avg_logprob: -0.2 }],
    });
    const stages = [
      computeStageReliability({
        kind: 'DUB',
        status: 'FAILED',
        startedAt: null,
        completedAt: null,
        attempts: 3,
        lastError: 'ffmpeg concat exit 1',
        artifacts: [],
      }),
    ];
    const overall = computeOverallReliability(stages, transcript);
    expect(overall.level).toBe('failed');
    // Headline score must not contradict the failed verdict (no 82% beside a
    // red badge) — it is nulled when a stage failed.
    expect(overall.scorePct).toBeNull();
    const w = overall.warnings.find((x) => x.code === 'stageFailed');
    expect(w?.severity).toBe('error');
    expect(w?.stage).toBe('DUB');
  });

  it('emits a highNoSpeech warning when the audio is mostly non-speech', () => {
    const transcript = computeTranscriptReliability({
      segments: [
        { start: 0, end: 10, avg_logprob: -0.2, no_speech_prob: 0.7 },
        { start: 10, end: 20, avg_logprob: -0.2, no_speech_prob: 0.65 },
      ],
    });
    const overall = computeOverallReliability([], transcript);
    expect(overall.warnings.some((w) => w.code === 'highNoSpeech')).toBe(true);
  });

  it('does NOT flag transcriptEmpty when the transcript was not analyzed (blob-stored / not run)', () => {
    const transcript = computeTranscriptReliability({ segments: [] });
    const overall = computeOverallReliability([], transcript, { transcriptAnalyzed: false });
    expect(overall.warnings.some((w) => w.code === 'transcriptEmpty')).toBe(false);
    expect(overall.scorePct).toBeNull();
    expect(overall.level).toBe('fair');
  });

  it('still marks failed on a stage failure even when transcript not analyzed', () => {
    const transcript = computeTranscriptReliability({ segments: [] });
    const stages = [
      computeStageReliability({
        kind: 'DUB',
        status: 'FAILED',
        startedAt: null,
        completedAt: null,
        attempts: 1,
        lastError: 'x',
        artifacts: [],
      }),
    ];
    const overall = computeOverallReliability(stages, transcript, { transcriptAnalyzed: false });
    expect(overall.level).toBe('failed');
    expect(overall.warnings.some((w) => w.code === 'stageFailed')).toBe(true);
  });

  it('emits a manyLowConfSegments warning when ≥30% of scored segments are low', () => {
    const transcript = computeTranscriptReliability({
      segments: [
        { start: 0, end: 5, avg_logprob: -0.1 },
        { start: 5, end: 10, avg_logprob: -0.1 },
        { start: 10, end: 15, avg_logprob: -0.9 }, // low (< -0.6)
      ],
    });
    const overall = computeOverallReliability([], transcript);
    expect(overall.warnings.some((w) => w.code === 'manyLowConfSegments')).toBe(true);
  });
});
