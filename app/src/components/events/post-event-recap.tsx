'use client';

/**
 * Post-event recap card shown at the top of the concluded event page.
 *
 * Pure presentation over the persisted, anonymized `EventRecap` aggregate
 * (see src/lib/events/recap.ts). Every section is conditional so an event that
 * produced no Q&A / polls / words still renders cleanly. Works for any event —
 * a recording is not required.
 */

import { useTranslations } from 'next-intl';

import type { EventRecap } from '@/lib/events/recap';

function Stars({ value }: { value: number }) {
  // Five stars, filled proportionally to the average (nearest half not needed;
  // full-star rounding keeps it legible at a glance).
  const rounded = Math.round(value);
  return (
    <span aria-hidden className="d-inline-flex align-items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg
          key={i}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={i <= rounded ? '#F2A900' : 'none'}
          stroke="#F2A900"
          strokeWidth="1.5"
        >
          <path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.8 5.9 21.4l1.4-6.8L2.2 9.9l6.9-.8L12 2z" />
        </svg>
      ))}
    </span>
  );
}

export default function PostEventRecap({
  recap,
  className,
}: {
  recap: EventRecap;
  className?: string;
}) {
  const t = useTranslations('events.recap');

  const hasStats = recap.headcount > 0 || recap.registrations > 0;
  const maxWordCount = Math.max(1, ...recap.topWords.map((w) => w.count));

  return (
    <section
      className={`p-4 rounded ${className ?? ''}`}
      style={{ border: '1px solid #e8e8e8', background: '#F5F7FB' }}
      aria-label={t('title')}
    >
      <h2 className="h5 fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
        {t('title')}
      </h2>
      <p className="text-secondary mb-3" style={{ fontSize: '0.88rem' }}>
        {t('intro')}
      </p>

      {/* Headline stats */}
      {hasStats && (
        <div className="d-flex flex-wrap gap-3 mb-3">
          {recap.headcount > 0 && (
            <div
              className="px-3 py-2 rounded bg-white text-center"
              style={{ minWidth: 120, border: '1px solid #dee5ec' }}
            >
              <div className="fw-bold" style={{ fontSize: '1.5rem', color: 'var(--app-primary)' }}>
                {recap.headcount}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                {t('participants')}
              </div>
            </div>
          )}
          {recap.registrations > 0 && (
            <div
              className="px-3 py-2 rounded bg-white text-center"
              style={{ minWidth: 120, border: '1px solid #dee5ec' }}
            >
              <div className="fw-bold" style={{ fontSize: '1.5rem', color: 'var(--app-primary)' }}>
                {recap.registrations}
              </div>
              <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                {t('registered')}
              </div>
            </div>
          )}
          {recap.feedback.average != null && recap.feedback.count > 0 && (
            <div
              className="px-3 py-2 rounded bg-white"
              style={{ minWidth: 120, border: '1px solid #dee5ec' }}
            >
              <div className="d-flex align-items-center gap-2">
                <span className="fw-bold" style={{ fontSize: '1.2rem', color: 'var(--app-text)' }}>
                  {recap.feedback.average.toFixed(1)}
                </span>
                <Stars value={recap.feedback.average} />
              </div>
              <div className="text-secondary" style={{ fontSize: '0.75rem' }}>
                {t('feedback')} · {t('feedbackCount', { count: recap.feedback.count })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top questions */}
      {recap.topQuestions.length > 0 && (
        <div className="mb-3">
          <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('topQuestions')}
          </h3>
          <ol className="mb-0 ps-3" style={{ fontSize: '0.9rem' }}>
            {recap.topQuestions.map((q, i) => (
              <li key={i} className="mb-1">
                <span style={{ color: 'var(--app-text)' }}>{q.text}</span>{' '}
                <span className="text-secondary">· {t('upvotes', { count: q.upvotes })}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Poll results */}
      {recap.polls.length > 0 && (
        <div className="mb-3">
          <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('polls')}
          </h3>
          <div className="d-flex flex-column gap-3">
            {recap.polls.map((poll, pi) => (
              <div key={pi}>
                <div className="fw-semibold mb-1" style={{ fontSize: '0.9rem', color: 'var(--app-text)' }}>
                  {poll.question}
                </div>
                <div className="d-flex flex-column gap-1">
                  {poll.options.map((opt, oi) => {
                    const pct =
                      poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
                    return (
                      <div key={oi}>
                        <div
                          className="d-flex justify-content-between"
                          style={{ fontSize: '0.82rem' }}
                        >
                          <span style={{ color: 'var(--app-text)' }}>{opt.text}</span>
                          <span className="text-secondary">{pct}%</span>
                        </div>
                        <div
                          className="rounded"
                          style={{ height: 6, background: '#dee5ec', overflow: 'hidden' }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: 'var(--app-primary)',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="text-secondary mt-1" style={{ fontSize: '0.75rem' }}>
                  {t('votes', { count: poll.totalVotes })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top words */}
      {recap.topWords.length > 0 && (
        <div>
          <h3 className="h6 fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
            {t('topWords')}
          </h3>
          <div className="d-flex flex-wrap gap-2">
            {recap.topWords.map((w, i) => {
              // Scale font size 0.8→1.3rem by relative frequency.
              const size = 0.8 + (w.count / maxWordCount) * 0.5;
              return (
                <span
                  key={i}
                  className="px-2 py-1 rounded bg-white"
                  style={{
                    border: '1px solid #dee5ec',
                    fontSize: `${size}rem`,
                    color: 'var(--app-primary)',
                  }}
                >
                  {w.word}
                  <span className="text-secondary" style={{ fontSize: '0.7rem' }}>
                    {' '}
                    ·{w.count}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
