import { describe, it, expect } from 'vitest';

import {
  formatOffset,
  bucketTimeline,
  speakerLeaderboard,
  gini,
  computeAttentionScore,
  summarizeHandRaises,
  retentionSignal,
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

  it('tallies the reaction kind onto the reaction field', () => {
    const r = bucketTimeline(pts([[0, 'reaction'], [1, 'reaction'], [2, 'chat']]), 0, 100, 24);
    const reactions = r.buckets.reduce((s, b) => s + b.reaction, 0);
    const chats = r.buckets.reduce((s, b) => s + b.chat, 0);
    expect(reactions).toBe(2);
    expect(chats).toBe(1);
    expect(r.totalInteractions).toBe(3);
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

describe('retentionSignal', () => {
  const at = (min: number): Date => new Date(2026, 0, 1, 10, min, 0);

  it('measures dwell + retention over registrants with both timestamps (≥ min sample)', () => {
    // duration 60 min; A 60m (ratio 1), B 60m (1), C 30m (0.5)
    const r = retentionSignal(
      [
        { joinedAt: at(0), leftAt: at(60) },
        { joinedAt: at(0), leftAt: at(60) },
        { joinedAt: at(0), leftAt: at(30) },
        { joinedAt: at(0), leftAt: null }, // no leftAt → excluded
        { joinedAt: null, leftAt: at(60) }, // no joinedAt → excluded
      ],
      3600,
    );
    expect(r.measured).toBe(3);
    expect(r.avgDwellSec).toBe(Math.round((3600 + 3600 + 1800) / 3)); // 3000
    expect(r.retention).toBeCloseTo((1 + 1 + 0.5) / 3, 5); // 0.8333
  });

  it('returns nulls when nothing is measurable', () => {
    expect(retentionSignal([], 3600)).toEqual({ measured: 0, avgDwellSec: null, retention: null });
    expect(retentionSignal([{ joinedAt: at(0), leftAt: null }], 3600)).toEqual({
      measured: 0, avgDwellSec: null, retention: null,
    });
  });

  it('suppresses retention below the minimum sample (but still reports avgDwell)', () => {
    const r = retentionSignal(
      [
        { joinedAt: at(0), leftAt: at(60) },
        { joinedAt: at(0), leftAt: at(30) },
      ],
      3600,
    );
    expect(r.measured).toBe(2); // < MIN_RETENTION_SAMPLE (3)
    expect(r.avgDwellSec).toBe(Math.round((3600 + 1800) / 2)); // 2700
    expect(r.retention).toBeNull(); // too small a sample to publish a %
  });

  it('floors negative dwell (clock skew) at 0 and clamps ratio at 1', () => {
    const r = retentionSignal(
      [
        { joinedAt: at(10), leftAt: at(5) }, // leftAt before joinedAt → 0
        { joinedAt: at(0), leftAt: at(120) }, // 120m over a 60m event → ratio clamped to 1
        { joinedAt: at(0), leftAt: at(60) }, // ratio 1
      ],
      3600,
    );
    expect(r.measured).toBe(3);
    expect(r.avgDwellSec).toBe(Math.round((0 + 7200 + 3600) / 3)); // 3600
    expect(r.retention).toBeCloseTo((0 + 1 + 1) / 3, 5); // 0.6667
  });

  it('retention is null when duration is unknown (0)', () => {
    const r = retentionSignal(
      [
        { joinedAt: at(0), leftAt: at(30) },
        { joinedAt: at(0), leftAt: at(30) },
        { joinedAt: at(0), leftAt: at(30) },
      ],
      0,
    );
    expect(r.measured).toBe(3);
    expect(r.avgDwellSec).toBe(1800);
    expect(r.retention).toBeNull();
  });
});
