/**
 * AI post-production reliability metrics.
 *
 * Turns raw pipeline artifacts (transcript segment stats + job timings +
 * model ids) into an operator-facing "how much can I trust this output"
 * report: confidence %, minutes worked, model used, and explicit warnings
 * when a stage produced nothing usable.
 *
 * Motivation (9 lug): a recording whose source audio was SILENT sailed
 * through the pipeline reporting "DONE" while producing an empty transcript
 * and a fully hallucinated summary. This module makes that failure loud —
 * 0 segments / low confidence surface as an error, not a confident lie.
 *
 * Pure + dependency-free so it unit-tests without a DB or network.
 */

export interface ReliabilitySegment {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string | null;
  avg_logprob?: number;
  no_speech_prob?: number;
}

export interface ReliabilityTranscript {
  segments?: ReliabilitySegment[];
  language?: string;
  speakers?: Array<{ diarLabel: string; totalSpeechSec?: number }>;
}

// Whisper reports avg_logprob per segment (a log-probability, typically
// in [-3, 0]). Good speech sits around -0.1..-0.5; the worker's
// hallucination filter drops anything below -1.0. We reuse the app's
// existing "borderline" threshold of -0.6 (see the public transcript route)
// so the two surfaces agree on what "low confidence" means.
export const LOWCONF_AVG_LOGPROB = -0.6;
const LOW_CONFIDENCE_SCORE_PCT = 40;
const GOOD_SCORE_PCT = 75;
const FAIR_SCORE_PCT = 50;
const MANY_LOWCONF_RATIO_PCT = 30;
// Above this mean no_speech probability the audio is mostly non-speech —
// a hallmark of silence + whisper hallucination even when a few segments
// survive with plausible avg_logprob.
const HIGH_NO_SPEECH_PCT = 50;

/** Map a whisper avg_logprob to a 0..1 confidence (exp of the log-prob). */
export function logprobToConfidence(avgLogprob: number): number {
  if (!Number.isFinite(avgLogprob)) return 0;
  return Math.min(1, Math.max(0, Math.exp(avgLogprob)));
}

export type TranscriptVerdict = 'empty' | 'low' | 'ok';

export interface TranscriptReliability {
  segments: number;
  speakers: number;
  /** Real speech time — union of segment intervals, overlaps merged. */
  speechSec: number;
  /**
   * Duration-weighted mean confidence, 0..100, or null if unscored.
   * Per segment: exp(avg_logprob) × (1 − no_speech_prob) so a segment whose
   * audio is likely silence drags the score down even if the tokens looked
   * plausible — the whole point of the metric.
   */
  avgConfidencePct: number | null;
  /** Duration-weighted mean no_speech probability, 0..100, or null. */
  avgNoSpeechPct: number | null;
  lowConfidenceSegments: number;
  lowConfidencePct: number | null;
  verdict: TranscriptVerdict;
}

/** Total time covered by a set of [start, end] intervals, overlaps merged. */
function mergedIntervalSec(intervals: Array<[number, number]>): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0]!;
  for (let i = 1; i < sorted.length; i += 1) {
    const [s, e] = sorted[i]!;
    if (s > curEnd) {
      total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else if (e > curEnd) {
      curEnd = e;
    }
  }
  total += curEnd - curStart;
  return total;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function computeTranscriptReliability(
  transcript: ReliabilityTranscript | null | undefined,
): TranscriptReliability {
  const segs = transcript?.segments ?? [];
  const declaredSpeakers = transcript?.speakers?.length ?? 0;

  if (segs.length === 0) {
    return {
      segments: 0,
      speakers: declaredSpeakers,
      speechSec: 0,
      avgConfidencePct: null,
      avgNoSpeechPct: null,
      lowConfidenceSegments: 0,
      lowConfidencePct: null,
      verdict: 'empty',
    };
  }

  let weightSum = 0;
  let weightedConf = 0;
  let weightedNoSpeech = 0;
  let scored = 0;
  let low = 0;
  const intervals: Array<[number, number]> = [];
  const speakerLabels = new Set<string>();

  for (const s of segs) {
    const start = typeof s.start === 'number' ? s.start : 0;
    const end = typeof s.end === 'number' ? s.end : start;
    const dur = Math.max(0, end - start);
    if (end > start) intervals.push([start, end]);
    // Only count real diarization labels — a null/absent speaker is NOT a
    // participant, so coalescing it to a placeholder would inflate the roster.
    if (s.speaker) speakerLabels.add(s.speaker);
    if (typeof s.avg_logprob === 'number') {
      scored += 1;
      const w = dur > 0 ? dur : 1;
      const noSpeech =
        typeof s.no_speech_prob === 'number' ? clamp01(s.no_speech_prob) : 0;
      weightSum += w;
      weightedConf += w * logprobToConfidence(s.avg_logprob) * (1 - noSpeech);
      weightedNoSpeech += w * noSpeech;
      if (s.avg_logprob < LOWCONF_AVG_LOGPROB) low += 1;
    }
  }

  const speechSec = mergedIntervalSec(intervals);
  const avgConfidencePct = weightSum > 0 ? (weightedConf / weightSum) * 100 : null;
  const avgNoSpeechPct = weightSum > 0 ? (weightedNoSpeech / weightSum) * 100 : null;
  const lowConfidencePct = scored > 0 ? (low / scored) * 100 : null;
  const speakers = declaredSpeakers > 0 ? declaredSpeakers : speakerLabels.size;

  const verdict: TranscriptVerdict =
    avgConfidencePct != null && avgConfidencePct < LOW_CONFIDENCE_SCORE_PCT ? 'low' : 'ok';

  return {
    segments: segs.length,
    speakers,
    speechSec,
    avgConfidencePct,
    avgNoSpeechPct,
    lowConfidenceSegments: low,
    lowConfidencePct,
    verdict,
  };
}

export type StageStatus = 'PENDING' | 'CLAIMED' | 'RUNNING' | 'DONE' | 'FAILED';

export interface StageArtifactInput {
  type: string;
  language: string | null;
  modelId: string | null;
  modelVersion: string | null;
  sizeBytes: number | null;
}

export interface StageJobInput {
  kind: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  artifacts: StageArtifactInput[];
}

export interface StageReliability {
  kind: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  /** Wall-clock seconds the stage ran, or null if never started/finished. */
  durationSec: number | null;
  /** Human model label ("large-v3 (whisperx-3.1)"), or null if unknown. */
  model: string | null;
  artifactCount: number;
  languages: string[];
}

export function computeStageReliability(job: StageJobInput): StageReliability {
  const durationSec =
    job.startedAt && job.completedAt
      ? Math.max(
          0,
          (new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000,
        )
      : null;

  const withModel = job.artifacts.find((a) => a.modelId);
  const model = withModel?.modelId
    ? withModel.modelVersion
      ? `${withModel.modelId} (${withModel.modelVersion})`
      : withModel.modelId
    : null;

  const languages = Array.from(
    new Set(job.artifacts.map((a) => a.language).filter((l): l is string => !!l)),
  ).sort();

  return {
    kind: job.kind,
    status: job.status,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    attempts: job.attempts,
    lastError: job.lastError,
    durationSec,
    model,
    artifactCount: job.artifacts.length,
    languages,
  };
}

export type ReliabilitySeverity = 'error' | 'warning' | 'info';
export type ReliabilityLevel = 'good' | 'fair' | 'poor' | 'failed';

export interface ReliabilityWarning {
  code: string;
  severity: ReliabilitySeverity;
  /** Optional stage kind the warning refers to. */
  stage?: string;
}

export interface OverallReliability {
  totalProcessingSec: number;
  scorePct: number | null;
  level: ReliabilityLevel;
  warnings: ReliabilityWarning[];
}

export interface OverallOptions {
  /**
   * Whether the transcript was actually read + analyzed. False when the
   * pipeline hasn't produced a transcript yet, or it's blob-stored and the
   * fetch failed — in which case an empty `transcript` must NOT be reported
   * as the silent-audio failure.
   */
  transcriptAnalyzed?: boolean;
}

export function computeOverallReliability(
  stages: StageReliability[],
  transcript: TranscriptReliability,
  opts: OverallOptions = {},
): OverallReliability {
  const transcriptAnalyzed = opts.transcriptAnalyzed ?? true;
  const totalProcessingSec = stages.reduce((acc, s) => acc + (s.durationSec ?? 0), 0);
  const warnings: ReliabilityWarning[] = [];

  if (transcriptAnalyzed) {
    if (transcript.verdict === 'empty') {
      warnings.push({ code: 'transcriptEmpty', severity: 'error' });
    } else {
      if (transcript.verdict === 'low') {
        warnings.push({ code: 'lowConfidence', severity: 'warning' });
      }
      if ((transcript.lowConfidencePct ?? 0) >= MANY_LOWCONF_RATIO_PCT) {
        warnings.push({ code: 'manyLowConfSegments', severity: 'warning' });
      }
      if ((transcript.avgNoSpeechPct ?? 0) >= HIGH_NO_SPEECH_PCT) {
        warnings.push({ code: 'highNoSpeech', severity: 'warning' });
      }
    }
  }

  const anyFailed = stages.some((s) => s.status === 'FAILED');
  for (const s of stages) {
    if (s.status === 'FAILED') {
      warnings.push({ code: 'stageFailed', severity: 'error', stage: s.kind });
    } else if (s.status === 'DONE' && s.attempts > 1) {
      warnings.push({ code: 'stageRetried', severity: 'info', stage: s.kind });
    }
  }

  const transcriptEmpty = transcriptAnalyzed && transcript.verdict === 'empty';
  // The headline "overall confidence" must never contradict a failed verdict
  // (e.g. a 95% figure beside a red badge when a downstream stage failed): it
  // is null whenever the run can't be trusted end-to-end.
  const scorePct =
    !transcriptAnalyzed || anyFailed
      ? null
      : transcript.verdict === 'empty'
        ? 0
        : transcript.avgConfidencePct;

  let level: ReliabilityLevel;
  if (transcriptEmpty || anyFailed) {
    level = 'failed';
  } else if (scorePct == null) {
    level = 'fair';
  } else if (scorePct >= GOOD_SCORE_PCT) {
    level = 'good';
  } else if (scorePct >= FAIR_SCORE_PCT) {
    level = 'fair';
  } else {
    level = 'poor';
  }

  return { totalProcessingSec, scorePct, level, warnings };
}
