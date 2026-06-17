'use client';

/**
 * Admin feedback dashboard — a focused view over POST_EVENT questionnaire
 * responses (the converged feedback subsystem). Reuses the existing
 * /api/admin/questionnaire-responses aggregation, filtered to POST_EVENT,
 * and renders LIKERT items as a star summary + distribution, OPEN_TEXT as
 * verbatim comment samples, and choice/yes-no as simple bars.
 *
 * Stars use inline SVG (not design-react-kit <Icon>) to stay hydration-safe.
 */

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Spinner } from 'design-react-kit';

type Localized = Record<string, string>;

interface ItemAggregate {
  itemId: string;
  prompt: Localized;
  type: 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';
  summary: {
    type: string;
    totalAnswered: number;
    average?: number | null;
    distribution?: Array<{
      value?: number;
      idx?: number;
      label?: Localized;
      count: number;
    }>;
    yes?: number;
    no?: number;
    samples?: string[];
  };
}

interface FeedbackRow {
  id: string;
  event: { id: string; slug: string; title: Localized };
  placement: string;
  title: Localized;
  responseCount: number;
  items: ItemAggregate[];
}

function localize(obj: Localized | undefined, locale: string): string {
  if (!obj) return '';
  if (obj[locale]) return obj[locale];
  if (obj.it) return obj.it;
  return Object.values(obj)[0] ?? '';
}

export default function FeedbackDashboard() {
  const locale = useLocale();
  const t = useTranslations('feedbackAdmin');
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          '/api/admin/questionnaire-responses?placement=POST_EVENT',
          {
            cache: 'no-store',
          }
        );
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          return;
        }
        const data = await res.json();
        setRows(data.rows ?? []);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {t('noFeedback')}
      </div>
    );
  }
  if (rows === null) {
    return (
      <div className="text-center py-5">
        <Spinner active small /> <span className="text-muted ms-2">…</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="alert alert-secondary" role="alert">
        {t('noFeedback')}
      </div>
    );
  }

  return (
    <div className="d-flex flex-column gap-3">
      {rows.map((row) => (
        <Card
          key={row.id}
          className="shadow-sm border-0"
          style={{ borderRadius: '0.5rem' }}
        >
          <CardBody className="p-3 p-md-4">
            <div className="d-flex justify-content-between align-items-start mb-3 gap-2">
              <h2 className="h5 fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                {localize(row.event.title, locale)}
              </h2>
              <Badge color="primary" pill>
                {row.responseCount} {t('totalVotes')}
              </Badge>
            </div>

            {row.responseCount === 0 ? (
              <p className="text-muted mb-0">{t('noFeedback')}</p>
            ) : (
              <div className="d-flex flex-column gap-4">
                {row.items.map((item) => (
                  <ItemSummary key={item.itemId} item={item} locale={locale} t={t} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function ItemSummary({
  item,
  locale,
  t,
}: {
  item: ItemAggregate;
  locale: string;
  t: ReturnType<typeof useTranslations>;
}) {
  const prompt = localize(item.prompt, locale);
  const s = item.summary;

  if (item.type === 'LIKERT') {
    const dist = s.distribution ?? [];
    const maxScale = dist.length > 0 ? Math.max(...dist.map((d) => d.value ?? 0)) : 5;
    const maxCount = Math.max(...dist.map((d) => d.count), 1);
    return (
      <div>
        <p className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
          {prompt}
        </p>
        <div className="d-flex align-items-center gap-2 mb-2">
          <StarRow value={s.average ?? 0} max={maxScale} />
          {s.average != null && (
            <span className="fw-semibold">
              {s.average.toFixed(1)}/{maxScale}
            </span>
          )}
          <span className="text-muted small">({s.totalAnswered})</span>
        </div>
        <div className="d-flex flex-column gap-1">
          {[...dist]
            .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
            .map((d) => {
              const pct =
                s.totalAnswered > 0 ? Math.round((d.count / s.totalAnswered) * 100) : 0;
              return (
                <div
                  key={d.value}
                  className="d-flex align-items-center gap-2"
                  style={{ fontSize: '0.85rem' }}
                >
                  <span style={{ width: 24, textAlign: 'right' }}>{d.value}</span>
                  <Bar widthPct={(d.count / maxCount) * 100} />
                  <span className="text-muted" style={{ width: 60, fontSize: '0.78rem' }}>
                    {pct}% ({d.count})
                  </span>
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  if (item.type === 'OPEN_TEXT') {
    const samples = s.samples ?? [];
    return (
      <div>
        <p className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
          {prompt}
        </p>
        <div className="text-muted small mb-2">{t('comments')}</div>
        {samples.length === 0 ? (
          <p className="text-muted mb-0">{t('noComments')}</p>
        ) : (
          <ul className="mb-0 ps-3">
            {samples.map((sample, i) => (
              <li key={i} className="mb-1" style={{ color: 'var(--app-text)' }}>
                {sample}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (item.type === 'YES_NO') {
    const yes = s.yes ?? 0;
    const no = s.no ?? 0;
    const total = yes + no || 1;
    return (
      <div>
        <p className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
          {prompt}
        </p>
        <div className="d-flex flex-column gap-1" style={{ fontSize: '0.85rem' }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 40 }}>{t('yes')}</span>
            <Bar widthPct={(yes / total) * 100} />
            <span className="text-muted" style={{ width: 60 }}>
              {yes}
            </span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 40 }}>{t('no')}</span>
            <Bar widthPct={(no / total) * 100} />
            <span className="text-muted" style={{ width: 60 }}>
              {no}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // SINGLE_CHOICE / MULTI_CHOICE
  const dist = s.distribution ?? [];
  const maxCount = Math.max(...dist.map((d) => d.count), 1);
  return (
    <div>
      <p className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
        {prompt}
      </p>
      <div className="d-flex flex-column gap-1" style={{ fontSize: '0.85rem' }}>
        {dist.map((d, i) => (
          <div key={i} className="d-flex align-items-center gap-2">
            <span style={{ minWidth: 90 }}>{localize(d.label, locale)}</span>
            <Bar widthPct={(d.count / maxCount) * 100} />
            <span className="text-muted" style={{ width: 40 }}>
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ widthPct }: { widthPct: number }) {
  return (
    <div className="flex-grow-1">
      <div className="progress" style={{ height: 8, borderRadius: 4 }}>
        <div
          className="progress-bar"
          style={{ width: `${widthPct}%`, borderRadius: 4, backgroundColor: '#FFB400' }}
        />
      </div>
    </div>
  );
}

function StarRow({ value, max }: { value: number; max: number }) {
  const filled = Math.round(value);
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <span className="d-inline-flex gap-1" aria-label={`${value.toFixed(1)}/${max}`}>
      {stars.map((n) => (
        <svg
          key={n}
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={n <= filled ? '#FFB400' : 'none'}
          stroke={n <= filled ? '#FFB400' : '#b1b1b3'}
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path
            strokeLinejoin="round"
            strokeLinecap="round"
            d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 18.6 6.09 21.7l1.13-6.57L2.45 9.54l6.6-.96z"
          />
        </svg>
      ))}
    </span>
  );
}
