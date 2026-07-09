'use client';

/**
 * "Statistiche" tab — post-event analytics for a single event.
 *
 * Self-fetches GET /api/admin/events/[id]/analytics and renders:
 *   - the composite attention score (participation proxy, admin-only) with its
 *     component breakdown;
 *   - KPI cards (conversion, peak, duration, distinct interactors);
 *   - the ENGAGEMENT TIMELINE — a stacked bar chart of interaction over the
 *     call showing when it peaked ("andamento della call");
 *   - a top-speakers leaderboard (recording-gated, pseudonymous by default);
 *   - chat, Q&A, polls, word-cloud and feedback breakdowns.
 *
 * Charts are inline CSS (no chart lib), light-only, no design-react-kit <Icon>
 * (hydration) — text glyphs / inline SVG only, matching recording-overview.tsx.
 */

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import useSWR from 'swr';

import { SkeletonLines } from '@/components/ui/skeleton';

// Colors per timeline interaction kind (distinct, .italia-adjacent).
const KIND_COLORS: Record<string, string> = {
  chat: '#0066cc',
  question: '#008758',
  upvote: '#e08e0b',
  poll: '#6c5ce7',
  word: '#d9364f',
  reaction: '#e83e8c',
};
const KIND_ORDER = ['chat', 'question', 'upvote', 'poll', 'word', 'reaction'] as const;

interface Bucket {
  startOffsetSec: number;
  label: string;
  chat: number; question: number; upvote: number; poll: number; word: number; reaction: number;
  total: number;
}
interface SpeakerStat { label: string; name: string; named: boolean; speechSec: number; sharePct: number }
interface AttentionComponent { key: string; value: number; weight: number; baseWeight: number }
interface Analytics {
  eventId: string;
  status: string;
  durationSec: number;
  attendance: {
    registered: number; joined: number; conversionPct: number | null; peakParticipants: number;
    dwellMeasured: number; avgDwellSec: number | null; retentionPct: number | null;
  };
  chat: { total: number; byModerator: number; byAudience: number; capped: boolean; topAuthors: { name: string; count: number }[] };
  interactions: { total: number; distinctInteractors: number; capped: boolean };
  handRaises: { total: number; distinctSessions: number };
  reactions: { total: number; byEmoji: { emoji: string; count: number }[]; capped: boolean };
  qa: { topQuestions: { text: string; upvotes: number }[] };
  polls: { question: string; options: { text: string; votes: number }[]; totalVotes: number }[];
  topWords: { word: string; count: number }[];
  feedback: { average: number | null; count: number };
  audio: {
    available: boolean; source: string | null; recordingStatus: string | null;
    speakers: SpeakerStat[]; talkBalancePct: number | null; speechDensityPct: number | null;
  };
  timeline: { buckets: Bucket[]; bucketSec: number; peakIndex: number; peakTotal: number; totalInteractions: number };
  attention: { score: number | null; components: AttentionComponent[]; missing: string[] };
}

const fetcher = (url: string): Promise<Analytics> =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Analytics>;
  });

function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function Kpi({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div className="border rounded p-3 text-center" style={{ background: '#fff', minWidth: 120, flex: '1 1 120px' }}>
      <div className="fw-bold" style={{ fontSize: '1.5rem', color: 'var(--app-text, #17324d)' }}>{value}</div>
      <div className="small text-secondary text-uppercase" style={{ fontSize: '0.66rem', letterSpacing: 0.4 }}>{label}</div>
      {sub && <div className="small text-secondary" style={{ fontSize: '0.72rem' }}>{sub}</div>}
    </div>
  );
}

// ── Attention score ──────────────────────────────────────────────────
function ScoreCard({ data }: { data: Analytics['attention'] }) {
  const t = useTranslations('admin.eventAnalytics');
  const score = data.score;
  const hue = score == null ? '#8b95a1' : score >= 66 ? '#008758' : score >= 33 ? '#e08e0b' : '#d9364f';
  return (
    <div className="border rounded p-3 mb-4" style={{ background: '#fff' }}>
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-1">
        <h6 className="fw-semibold mb-0">{t('scoreTitle')}</h6>
        <span className="badge bg-light text-secondary border" style={{ fontSize: '0.62rem' }}>{t('adminOnly')}</span>
      </div>
      <p className="small text-secondary mb-3" style={{ fontSize: '0.8rem' }}>{t('scoreProxy')}</p>
      {score == null ? (
        <p className="text-secondary small mb-0">{t('scoreUnavailable')}</p>
      ) : (
        <>
          <div className="d-flex align-items-baseline gap-2 mb-2">
            <span className="fw-bold" style={{ fontSize: '2.6rem', lineHeight: 1, color: hue }}>{score}</span>
            <span className="text-secondary">/ 100</span>
          </div>
          <div style={{ height: 10, background: '#eef1f4', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${score}%`, height: '100%', background: hue, borderRadius: 999 }} />
          </div>
          <div className="d-flex flex-column gap-1 mt-3">
            {data.components.map((c) => (
              <div key={c.key} className="d-flex align-items-center gap-2" style={{ fontSize: '0.78rem' }}>
                <span className="text-secondary" style={{ minWidth: 150 }}>{t.has(`comp.${c.key}`) ? t(`comp.${c.key}`) : c.key}</span>
                <div style={{ flex: 1, height: 6, background: '#eef1f4', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.round(c.value * 100)}%`, height: '100%', background: 'var(--app-primary, #06c)', opacity: 0.85 }} />
                </div>
                <span className="text-secondary" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'right' }}>{Math.round(c.value * 100)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Engagement timeline (the "andamento della call" chart) ────────────
function EngagementTimeline({ data }: { data: Analytics['timeline'] }) {
  const t = useTranslations('admin.eventAnalytics');
  const { buckets, peakIndex } = data;
  if (buckets.length === 0 || data.totalInteractions === 0) {
    return <p className="text-secondary small mb-0">{t('timelineEmpty')}</p>;
  }
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1);
  const H = 168;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <div>
      <div className="d-flex flex-wrap gap-3 mb-2">
        {KIND_ORDER.map((k) => (
          <span key={k} className="d-flex align-items-center gap-1" style={{ fontSize: '0.72rem' }}>
            <span className="d-inline-block rounded" style={{ width: 11, height: 11, background: KIND_COLORS[k] }} />
            <span className="text-secondary">{t.has(`kind.${k}`) ? t(`kind.${k}`) : k}</span>
          </span>
        ))}
      </div>
      <div className="d-flex align-items-end gap-1" style={{ height: H + 22, overflowX: 'auto' }}>
        {buckets.map((b, i) => {
          const isPeak = i === peakIndex && b.total > 0;
          const parts = b.total > 0 ? `${b.label} · ${b.total}` : b.label;
          return (
            <div key={i} className="text-center" style={{ flex: '1 1 0', minWidth: 12, maxWidth: 34 }}>
              <div
                className="d-flex flex-column-reverse mx-auto"
                style={{
                  height: H, width: '72%',
                  outline: isPeak ? '2px solid #17324d' : 'none',
                  outlineOffset: 1, borderRadius: '3px 3px 0 0', overflow: 'hidden',
                }}
                title={parts}
              >
                {KIND_ORDER.map((k) => {
                  const v = b[k];
                  if (!v) return null;
                  return <div key={k} style={{ height: `${(v / maxTotal) * 100}%`, background: KIND_COLORS[k], minHeight: 1 }} />;
                })}
              </div>
              {(i % labelEvery === 0 || i === buckets.length - 1) && (
                <small className="text-secondary d-block" style={{ fontSize: '0.58rem', whiteSpace: 'nowrap' }}>{b.label}</small>
              )}
            </div>
          );
        })}
      </div>
      {peakIndex >= 0 && (
        <p className="small text-secondary mt-2 mb-0" style={{ fontSize: '0.78rem' }}>
          {t('timelinePeak', { at: buckets[peakIndex]?.label ?? '', n: data.peakTotal })}
        </p>
      )}
    </div>
  );
}

// ── Speakers leaderboard ─────────────────────────────────────────────
function SpeakerBars({ audio }: { audio: Analytics['audio'] }) {
  const t = useTranslations('admin.eventAnalytics');
  if (!audio.available) {
    return <p className="text-secondary small mb-0">{t('audioUnavailable')}</p>;
  }
  const max = Math.max(...audio.speakers.map((s) => s.speechSec), 1);
  return (
    <div>
      <div className="d-flex flex-column gap-2">
        {audio.speakers.map((s, i) => (
          <div key={s.label} className="d-flex align-items-center gap-2" style={{ fontSize: '0.82rem' }}>
            <span style={{ minWidth: 130 }} className="text-truncate">
              {i === 0 && <span title={t('predominant')}>★ </span>}
              <span className={s.named ? '' : 'text-secondary'}>{s.name}</span>
            </span>
            <div style={{ flex: 1, height: 14, background: '#eef1f4', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${(s.speechSec / max) * 100}%`, height: '100%', background: 'var(--app-primary, #06c)', opacity: 0.9 }} />
            </div>
            <span className="text-secondary" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 78, textAlign: 'right' }}>
              {fmtDur(s.speechSec)} · {Math.round(s.sharePct)}%
            </span>
          </div>
        ))}
      </div>
      <div className="d-flex gap-3 mt-3 small text-secondary" style={{ fontSize: '0.76rem' }}>
        {audio.talkBalancePct != null && <span>{t('talkBalance')}: <b>{audio.talkBalancePct}%</b></span>}
        {audio.speechDensityPct != null && <span>{t('speechDensity')}: <b>{audio.speechDensityPct}%</b></span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <h6 className="fw-semibold mb-2">{title}</h6>
      {children}
    </div>
  );
}

export default function EventAnalyticsPanel({ eventId, status }: { eventId: string; status: string }) {
  const t = useTranslations('admin.eventAnalytics');
  const { data, error, isLoading } = useSWR<Analytics>(
    `/api/admin/events/${eventId}/analytics`,
    fetcher,
  );

  if (isLoading) return <SkeletonLines lines={8} loadingLabel={t('title')} />;
  if (error) return <div className="alert alert-danger small mb-0" role="alert">{t('loadError')}</div>;
  if (!data) return <div className="alert alert-info small mb-0" role="status">{t('noData')}</div>;

  const a = data;
  // Partial only before the event has concluded — ENDED and ARCHIVED are both
  // final states and must not show the "real-time / partial" banner.
  const partial = status !== 'ENDED' && status !== 'ARCHIVED';

  return (
    <div>
      {partial && (
        <div className="alert alert-info small" role="status">{t('notEndedYet')}</div>
      )}
      {a.interactions.capped && (
        <div className="alert alert-warning small" role="status">{t('cappedNote')}</div>
      )}

      <ScoreCard data={a.attention} />

      <div className="d-flex flex-wrap gap-2 mb-4">
        <Kpi value={a.attendance.conversionPct != null ? `${a.attendance.conversionPct}%` : '–'}
          label={t('kpiConversion')} sub={`${a.attendance.joined}/${a.attendance.registered}`} />
        <Kpi value={String(a.attendance.peakParticipants)} label={t('kpiPeak')} />
        <Kpi value={fmtDur(a.durationSec)} label={t('kpiDuration')} />
        <Kpi value={String(a.interactions.distinctInteractors)} label={t('kpiInteractors')}
          sub={`${a.interactions.total} ${t('interactionsWord')}`} />
        <Kpi value={String(a.handRaises.total)} label={t('kpiHandRaises')}
          sub={t('handRaisesSessionsSub', { n: a.handRaises.distinctSessions })} />
        <Kpi value={String(a.reactions.total)} label={t('kpiReactions')} />
        {a.attendance.retentionPct != null && (
          <Kpi value={`${a.attendance.retentionPct}%`} label={t('kpiRetention')}
            sub={a.attendance.avgDwellSec != null
              ? t('dwellSub', { d: fmtDur(a.attendance.avgDwellSec), n: a.attendance.dwellMeasured })
              : undefined} />
        )}
      </div>

      <Section title={t('timelineTitle')}>
        <EngagementTimeline data={a.timeline} />
      </Section>

      <Section title={t('speakersTitle')}>
        <SpeakerBars audio={a.audio} />
      </Section>

      <div className="row g-3">
        <div className="col-md-6">
          <Section title={t('chatTitle')}>
            <div className="d-flex flex-wrap gap-2 mb-2">
              <Kpi value={String(a.chat.byAudience)} label={t('chatAudience')} />
              <Kpi value={String(a.chat.byModerator)} label={t('chatStaff')} />
            </div>
            {a.chat.topAuthors.length > 0 && (
              <ul className="list-unstyled small mb-0">
                {a.chat.topAuthors.map((au) => (
                  <li key={au.name} className="d-flex justify-content-between border-bottom py-1">
                    <span className="text-truncate">{au.name}</span>
                    <span className="text-secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>{au.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="col-md-6">
          <Section title={t('qaTitle')}>
            {a.qa.topQuestions.length === 0 ? (
              <p className="text-secondary small mb-0">{t('none')}</p>
            ) : (
              <ul className="list-unstyled small mb-0">
                {a.qa.topQuestions.map((q, i) => (
                  <li key={i} className="d-flex justify-content-between gap-2 border-bottom py-1">
                    <span className="text-truncate">{q.text}</span>
                    <span className="text-secondary" style={{ whiteSpace: 'nowrap' }}>▲ {q.upvotes}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {a.polls.length > 0 && (
        <Section title={t('pollsTitle')}>
          {a.polls.map((p, pi) => {
            const max = Math.max(...p.options.map((o) => o.votes), 1);
            return (
              <div key={pi} className="mb-3">
                <div className="small fw-medium mb-1">{p.question} <span className="text-secondary">({p.totalVotes})</span></div>
                {p.options.map((o, oi) => (
                  <div key={oi} className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: '0.8rem' }}>
                    <span style={{ minWidth: 120 }} className="text-truncate text-secondary">{o.text}</span>
                    <div style={{ flex: 1, height: 12, background: '#eef1f4', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(o.votes / max) * 100}%`, height: '100%', background: '#008758', opacity: 0.85 }} />
                    </div>
                    <span className="text-secondary" style={{ minWidth: 26, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{o.votes}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </Section>
      )}

      {a.topWords.length > 0 && (
        <Section title={t('wordsTitle')}>
          <div className="d-flex flex-wrap gap-2">
            {a.topWords.map((w) => (
              <span key={w.word} className="badge bg-light text-dark border"
                style={{ fontSize: `${Math.min(1.4, 0.75 + w.count * 0.12)}rem` }}>
                {w.word} <span className="text-secondary">{w.count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {a.reactions.total > 0 && (
        <Section title={t('reactionsTitle')}>
          <div className="d-flex flex-wrap gap-3">
            {a.reactions.byEmoji.map((r) => (
              <span key={r.emoji} aria-label={`${r.emoji} ${r.count}`}
                className="d-flex align-items-center gap-1 border rounded px-2 py-1"
                style={{ fontSize: '1.1rem', background: '#fff' }}>
                <span aria-hidden>{r.emoji}</span>
                <span aria-hidden className="text-secondary" style={{ fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>{r.count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      {a.feedback.count > 0 && a.feedback.average != null && (
        <Section title={t('feedbackTitle')}>
          <span className="fw-bold" style={{ fontSize: '1.3rem' }}>{a.feedback.average.toFixed(1)}</span>
          <span className="text-secondary"> / 5 · {a.feedback.count} {t('responses')}</span>
        </Section>
      )}

      <p className="text-secondary mt-3 mb-0" style={{ fontSize: '0.72rem' }}>{t('privacyNote')}</p>
    </div>
  );
}
