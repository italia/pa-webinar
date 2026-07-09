/**
 * Post-event analytics — pure computation.
 *
 * Turns the raw rows the live features already persist (chat, Q&A, polls,
 * word-cloud, registrations, speaker talk-time) into event-level statistics:
 * an engagement TIMELINE (when interaction peaked), a top-speakers leaderboard,
 * and a composite ATTENTION SCORE.
 *
 * Everything here is a pure function of its inputs (no Prisma, no I/O) so it is
 * unit-tested directly. The route (app/src/app/api/admin/events/[id]/analytics)
 * does the fetching and calls into this module.
 *
 * Design notes:
 *  - The attention score is a PARTICIPATION proxy, not cognitive attention. It
 *    renormalizes its weights over only the signals available for the event, so
 *    it degrades gracefully (no recording → drop talk-balance; no leftAt → drop
 *    retention) and still returns an honest 0-100.
 *  - Per-person speaker stats are PSEUDONYMOUS by default (Partecipante N),
 *    real names only where a displayName was already supplied/mapped.
 */

// ── Engagement timeline ──────────────────────────────────────────────

export type TimelineKind = 'chat' | 'question' | 'upvote' | 'poll' | 'word';

export interface TimelinePoint {
  atMs: number; // absolute epoch ms
  kind: TimelineKind;
}

export interface EngagementBucket {
  startOffsetSec: number; // seconds from window start
  label: string; // pre-formatted relative label, e.g. "12m" or "1:05h"
  chat: number;
  question: number;
  upvote: number;
  poll: number;
  word: number;
  total: number;
}

export interface EngagementTimeline {
  buckets: EngagementBucket[];
  bucketSec: number;
  peakIndex: number; // index of the busiest bucket (-1 if empty)
  peakTotal: number;
  totalInteractions: number;
}

/** Relative offset → short label. Minutes under an hour, else H:MMh. */
export function formatOffset(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}h`;
}

/**
 * Bucket timestamped interaction points into ~targetBuckets bins spanning
 * [startMs, endMs]. Points outside the window are clamped in. A degenerate
 * window (zero/negative span) collapses to a single bucket holding everything.
 */
export function bucketTimeline(
  points: TimelinePoint[],
  startMs: number,
  endMs: number,
  targetBuckets = 24,
): EngagementTimeline {
  const empty: EngagementTimeline = {
    buckets: [],
    bucketSec: 0,
    peakIndex: -1,
    peakTotal: 0,
    totalInteractions: 0,
  };
  if (points.length === 0) return empty;

  const span = endMs - startMs;
  const n = Math.max(1, Math.min(targetBuckets, points.length));
  const bucketMs = span > 0 ? Math.ceil(span / n) : 1;
  const count = span > 0 ? Math.max(1, Math.ceil(span / bucketMs)) : 1;

  const buckets: EngagementBucket[] = Array.from({ length: count }, (_, i) => ({
    startOffsetSec: Math.round((i * bucketMs) / 1000),
    label: formatOffset((i * bucketMs) / 1000),
    chat: 0,
    question: 0,
    upvote: 0,
    poll: 0,
    word: 0,
    total: 0,
  }));

  for (const p of points) {
    let idx = span > 0 ? Math.floor((p.atMs - startMs) / bucketMs) : 0;
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    const b = buckets[idx];
    if (!b) continue;
    b[p.kind] += 1;
    b.total += 1;
  }

  let peakIndex = -1;
  let peakTotal = 0;
  let totalInteractions = 0;
  for (let i = 0; i < buckets.length; i++) {
    const t = buckets[i]?.total ?? 0;
    totalInteractions += t;
    if (t > peakTotal) {
      peakTotal = t;
      peakIndex = i;
    }
  }

  return { buckets, bucketSec: Math.round(bucketMs / 1000), peakIndex, peakTotal, totalInteractions };
}

// ── Speaker leaderboard ──────────────────────────────────────────────

export interface SpeakerInput {
  diarLabel: string;
  displayName: string | null;
  speechSec: number;
}

export interface SpeakerStat {
  label: string; // diarLabel (SPEAKER_00) — stable pseudonymous key
  name: string; // displayName if set, else "Partecipante N"
  named: boolean; // true when a real displayName was supplied
  speechSec: number;
  sharePct: number; // 0-100 of total talk time
}

/**
 * Order speakers by talk time, compute each one's share, and give the
 * unnamed ones a stable "Partecipante N" pseudonym (N by descending talk
 * time, matching the public transcript numbering).
 */
export function speakerLeaderboard(speakers: SpeakerInput[]): SpeakerStat[] {
  const sorted = [...speakers].sort((a, b) => b.speechSec - a.speechSec);
  const total = sorted.reduce((s, x) => s + Math.max(0, x.speechSec), 0);
  let anon = 0;
  return sorted.map((s) => {
    const named = !!(s.displayName && s.displayName.trim());
    if (!named) anon += 1;
    return {
      label: s.diarLabel,
      name: named ? (s.displayName as string).trim() : `Partecipante ${anon}`,
      named,
      speechSec: Math.max(0, Math.round(s.speechSec)),
      sharePct: total > 0 ? (Math.max(0, s.speechSec) / total) * 100 : 0,
    };
  });
}

/**
 * Gini coefficient of a distribution (0 = perfectly equal, →1 = one speaker
 * dominates). Used for the talk-time BALANCE signal (balance = 1 − Gini).
 */
export function gini(values: number[]): number {
  const v = values.filter((x) => x >= 0);
  const n = v.length;
  if (n === 0) return 0;
  const sum = v.reduce((s, x) => s + x, 0);
  if (sum === 0) return 0;
  const sorted = [...v].sort((a, b) => a - b);
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * (sorted[i] ?? 0);
  // Gini = (2·Σ i·x_i)/(n·Σx) − (n+1)/n
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

// ── Attention / engagement score ─────────────────────────────────────

export interface AttentionSignals {
  attendanceRate: number | null; // joined / registered
  breadth: number | null; // distinct interactors / attendees
  depth: number | null; // interactions / attendees (capped)
  chatRate: number | null; // msgs per attendee per hour (capped)
  liveParticipation: number | null; // poll/word voters / attendees
  talkBalance: number | null; // 1 − Gini(speech shares); recorded only
  retention: number | null; // avg dwell / duration; P1 only
}

export interface AttentionComponent {
  key: keyof AttentionSignals;
  value: number; // 0-1 normalized
  weight: number; // renormalized weight actually applied
  baseWeight: number;
}

export interface AttentionScore {
  score: number | null; // 0-100, null when no signal available
  components: AttentionComponent[]; // only the present ones
  missing: (keyof AttentionSignals)[];
}

const BASE_WEIGHTS: Record<keyof AttentionSignals, number> = {
  attendanceRate: 0.2,
  breadth: 0.2,
  depth: 0.15,
  chatRate: 0.15,
  liveParticipation: 0.15,
  talkBalance: 0.1,
  retention: 0.05,
};

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Weighted attention score with graceful degradation: weights are
 * renormalized over ONLY the signals that are present (non-null), so an
 * un-recorded, dwell-less event still returns an honest 0-100.
 */
export function computeAttentionScore(signals: AttentionSignals): AttentionScore {
  const keys = Object.keys(BASE_WEIGHTS) as (keyof AttentionSignals)[];
  const present = keys.filter((k) => signals[k] != null);
  const missing = keys.filter((k) => signals[k] == null);
  if (present.length === 0) return { score: null, components: [], missing };

  const totalBase = present.reduce((s, k) => s + BASE_WEIGHTS[k], 0);
  let acc = 0;
  const components: AttentionComponent[] = present.map((k) => {
    const value = clamp01(signals[k] as number);
    const weight = BASE_WEIGHTS[k] / totalBase;
    acc += weight * value;
    return { key: k, value, weight, baseWeight: BASE_WEIGHTS[k] };
  });

  return { score: Math.round(clamp01(acc) * 100), components, missing };
}

// ── Hand-raise stats ─────────────────────────────────────────────────

export interface HandRaiseLogEntry {
  participantId?: string; // Jitsi endpoint id of the raiser's session
  raised?: boolean;
}

export interface HandRaiseStats {
  total: number; // RAISE actions (raised === true)
  distinctSessions: number; // distinct raising SESSIONS (endpoint ids)
}

/**
 * Summarize a CallSession.handRaiseLog into a raise count + distinct raising
 * sessions.
 *
 * Each entry is SELF-REPORTED by the raiser's own client (see jitsi-room.tsx):
 * `raiseHandUpdated` is broadcast to every participant, so to avoid ~P× inflation
 * only the raiser persists their own event. That gives exactly one record per
 * raise, keyed by the raiser's Jitsi ENDPOINT id — an opaque per-SESSION id
 * (fresh on each (re)join), NOT a stable person id. So `distinctSessions` counts
 * distinct raising sessions (a rejoin is honestly a new session), and the metric
 * stands alone — it is NOT cross-linked into the interactor/attention sets.
 * Moderators are excluded at capture time; lowered events never count.
 */
export function summarizeHandRaises(log: HandRaiseLogEntry[]): HandRaiseStats {
  let total = 0;
  const sessions = new Set<string>();
  for (const e of log) {
    if (!e || e.raised !== true || typeof e.participantId !== 'string' || !e.participantId) continue;
    total += 1;
    sessions.add(e.participantId);
  }
  return { total, distinctSessions: sessions.size };
}
