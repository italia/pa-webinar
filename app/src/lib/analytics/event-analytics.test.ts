import { describe, it, expect } from 'vitest';

import {
  formatOffset,
  bucketTimeline,
  speakerLeaderboard,
  gini,
  computeAttentionScore,
  summarizeHandRaises,
  type TimelinePoint,
  type AttentionSignals,
} from './event-analytics';

describe('formatOffset', () => {
  it('renders minutes under an hour', () => {
    expect(formatOffset(0)).toBe('0m');
    expect(formatOffset(90)).toBe('2m'); // rounds
    expect(formatOffset(600)).toBe('10m');
  });
  it('renders H:MMh at/over an hour', () => {
    expect(formatOffset(3600)).toBe('1:00h');
    expect(formatOffset(3900)).toBe('1:05h');
  });
  it('never goes negative', () => {
    expect(formatOffset(-100)).toBe('0m');
  });
});

describe('bucketTimeline', () => {
  const pts = (arr: [number, TimelinePoint['kind']][]): TimelinePoint[] =>
    arr.map(([atMs, kind]) => ({ atMs, kind }));

  it('returns empty for no points', () => {
    const r = bucketTimeline([], 0, 1000);
    expect(r.buckets).toHaveLength(0);
    expect(r.peakIndex).toBe(-1);
    expect(r.totalInteractions).toBe(0);
  });

  it('buckets points across the window and finds the peak', () => {
    // window 0..1200s (1.2M ms), 24 buckets → 50s each
    const start = 0;
    const end = 1_200_000;
    const points = pts([
      [10_000, 'chat'],
      [20_000, 'chat'], // both in bucket 0
      [600_000, 'question'], // middle
      [600_500, 'poll'],
      [600_800, 'chat'], // bucket ~12 → 3 events = peak
    ]);
    const r = bucketTimeline(points, start, end, 24);
    expect(r.totalInteractions).toBe(5);
    expect(r.peakTotal).toBe(3);
    // peak bucket sits around the middle
    expect(r.buckets[r.peakIndex]?.total).toBe(3);
    expect(r.buckets[r.peakIndex]?.chat).toBe(1);
    expect(r.buckets[r.peakIndex]?.question).toBe(1);
    expect(r.buckets[r.peakIndex]?.poll).toBe(1);
  });

  it('counts kinds correctly in the first bucket', () => {
    const r = bucketTimeline(pts([[0, 'chat'], [1, 'upvote'], [2, 'word']]), 0, 100, 24);
    const total = r.buckets.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(3);
  });

  it('collapses a degenerate (zero-span) window to one bucket', () => {
    const r = bucketTimeline(pts([[5, 'chat'], [5, 'chat']]), 5, 5);
    expect(r.buckets).toHaveLength(1);
    expect(r.buckets[0]?.total).toBe(2);
  });

  it('clamps out-of-window points into the edge buckets', () => {
    const r = bucketTimeline(pts([[-1000, 'chat'], [999_999, 'chat']]), 0, 1000, 10);
    expect(r.totalInteractions).toBe(2);
    expect(r.buckets[0]?.chat).toBeGreaterThanOrEqual(1);
    expect(r.buckets[r.buckets.length - 1]?.chat).toBeGreaterThanOrEqual(1);
  });
});

describe('speakerLeaderboard', () => {
  it('orders by talk time, computes shares, pseudonymizes the unnamed', () => {
    const r = speakerLeaderboard([
      { diarLabel: 'SPEAKER_01', displayName: null, speechSec: 100 },
      { diarLabel: 'SPEAKER_00', displayName: 'Mario Rossi', speechSec: 300 },
      { diarLabel: 'SPEAKER_02', displayName: null, speechSec: 100 },
    ]);
    expect(r[0]?.name).toBe('Mario Rossi'); // predominant
    expect(r[0]?.named).toBe(true);
    expect(Math.round(r[0]?.sharePct ?? 0)).toBe(60);
    // the two unnamed become Partecipante 1 / 2 by descending speech order
    expect(r[1]?.name).toBe('Partecipante 1');
    expect(r[2]?.name).toBe('Partecipante 2');
    expect(r[1]?.named).toBe(false);
  });

  it('handles all-zero talk time without NaN shares', () => {
    const r = speakerLeaderboard([{ diarLabel: 'S0', displayName: null, speechSec: 0 }]);
    expect(r[0]?.sharePct).toBe(0);
  });
});

describe('gini', () => {
  it('is 0 for a perfectly equal distribution', () => {
    expect(gini([10, 10, 10, 10])).toBeCloseTo(0, 5);
  });
  it('approaches high values when one dominates', () => {
    expect(gini([0, 0, 0, 100])).toBeGreaterThan(0.6);
  });
  it('is 0 for empty or all-zero input', () => {
    expect(gini([])).toBe(0);
    expect(gini([0, 0])).toBe(0);
  });
  it('is 0 for a single value — the route must guard the monologue case', () => {
    // gini([300]) === 0 would make talkBalance = 1 (misleading "100% balanced");
    // the route drops talkBalance to null when speakers < 2 instead.
    expect(gini([300])).toBe(0);
  });
});

describe('computeAttentionScore', () => {
  const full: AttentionSignals = {
    attendanceRate: 1,
    breadth: 1,
    depth: 1,
    chatRate: 1,
    liveParticipation: 1,
    talkBalance: 1,
    retention: 1,
  };

  it('returns 100 when every signal is maxed', () => {
    expect(computeAttentionScore(full).score).toBe(100);
  });

  it('returns 0 when every present signal is 0', () => {
    const zero = { ...full } as AttentionSignals;
    (Object.keys(zero) as (keyof AttentionSignals)[]).forEach((k) => (zero[k] = 0));
    expect(computeAttentionScore(zero).score).toBe(0);
  });

  it('returns null when no signal is available', () => {
    const none: AttentionSignals = {
      attendanceRate: null, breadth: null, depth: null, chatRate: null,
      liveParticipation: null, talkBalance: null, retention: null,
    };
    const r = computeAttentionScore(none);
    expect(r.score).toBeNull();
    expect(r.components).toHaveLength(0);
    expect(r.missing).toHaveLength(7);
  });

  it('renormalizes weights over only the present signals', () => {
    // Only attendance (1.0) and breadth (0.0) present → weights .20/.20 → 0.5
    const partial: AttentionSignals = {
      attendanceRate: 1, breadth: 0, depth: null, chatRate: null,
      liveParticipation: null, talkBalance: null, retention: null,
    };
    const r = computeAttentionScore(partial);
    expect(r.score).toBe(50);
    expect(r.components).toHaveLength(2);
    expect(r.components.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
    expect(r.missing).toHaveLength(5);
  });

  it('clamps out-of-range signal values', () => {
    const over: AttentionSignals = {
      attendanceRate: 5, breadth: null, depth: null, chatRate: null,
      liveParticipation: null, talkBalance: null, retention: null,
    };
    expect(computeAttentionScore(over).score).toBe(100);
  });
});

describe('summarizeHandRaises', () => {
  // participantId is the raiser's opaque Jitsi endpoint id (~8 hex); entries are
  // self-reported so there is one record per raise (no broadcast fan-out).
  it('counts raises (not lowers) and dedups raising sessions by endpoint id', () => {
    const r = summarizeHandRaises([
      { participantId: 'a1b2c3d4', raised: true },
      { participantId: 'a1b2c3d4', raised: false }, // lower → ignored
      { participantId: 'a1b2c3d4', raised: true }, // same session raises again
      { participantId: 'e5f6a7b8', raised: true },
    ]);
    expect(r.total).toBe(3); // 2 raises from one session + 1 from another
    expect(r.distinctSessions).toBe(2);
  });
  it('is empty for an empty or all-lowered log', () => {
    expect(summarizeHandRaises([])).toEqual({ total: 0, distinctSessions: 0 });
    expect(summarizeHandRaises([{ participantId: 'a1b2c3d4', raised: false }])).toEqual({
      total: 0,
      distinctSessions: 0,
    });
  });
  it('tolerates malformed entries', () => {
    const r = summarizeHandRaises([
      { raised: true }, // no participantId
      { participantId: 'a1b2c3d4' }, // no raised flag
      { participantId: '', raised: true }, // empty id
      { participantId: 'a1b2c3d4', raised: true },
    ]);
    expect(r.total).toBe(1);
    expect(r.distinctSessions).toBe(1);
  });
});
