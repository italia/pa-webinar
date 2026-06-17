'use client';

/**
 * Renders a questionnaire (fetched from the public endpoint) and submits
 * the participant's answers. Usable for both PRE_REGISTRATION (called
 * after a successful registration — passing accessToken) and POST_EVENT
 * (called from the post-event flow / call-exit feedback modal).
 *
 * Two visual variants:
 *   - 'default'  → each item renders a native control (radios, checkboxes,
 *                  textarea). Used inside the registration success screen.
 *   - 'feedback' → LIKERT items render as a star scale (inline SVG, no
 *                  design-react-kit <Icon> to avoid hydration mismatches),
 *                  matching the post-event feedback look. Other item types
 *                  fall back to the native controls.
 *
 * Localizes prompts/options using the current next-intl locale, falling
 * back to Italian then the first available locale. Chrome labels (submit,
 * thank-you, loading) are passed in by the caller so the surrounding UI
 * owns the translations; sensible Italian defaults keep the existing
 * registration flow unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Label } from 'design-react-kit';

type QuestionType = 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'YES_NO' | 'LIKERT' | 'OPEN_TEXT';

interface RenderedItem {
  id: string;
  prompt: Record<string, string>;
  type: QuestionType;
  options: Record<string, string>[] | null;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel?: Record<string, string> | null;
  scaleMaxLabel?: Record<string, string> | null;
  required: boolean;
}

interface RenderedQuestionnaire {
  id: string;
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  title: Record<string, string>;
  description: Record<string, string>;
  items: RenderedItem[];
}

type Value = { text?: string; choices?: number[]; scale?: number };

export interface QuestionnaireFormProps {
  eventSlug: string;
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  /** One of these is required to identify the respondent. */
  accessToken?: string;
  guestId?: string;
  /** Visual variant — 'feedback' renders LIKERT as a star scale. */
  variant?: 'default' | 'feedback';
  /** Hide the questionnaire's own title/description (the caller renders it). */
  hideHeader?: boolean;
  /** Chrome labels (defaults preserve the original registration flow). */
  submitLabel?: string;
  submittingLabel?: string;
  submittedMessage?: string;
  /** Called once the questionnaire is known to be absent (404). Lets a
   *  wrapper fall back to a different UI (e.g. the legacy single-star). */
  onNotFound?: () => void;
  /** Callback fired after a successful submission. */
  onSubmitted?: () => void;
}

export default function QuestionnaireForm({
  eventSlug,
  placement,
  accessToken,
  guestId,
  variant = 'default',
  hideHeader = false,
  submitLabel,
  submittingLabel,
  submittedMessage,
  onNotFound,
  onSubmitted,
}: QuestionnaireFormProps) {
  const locale = useLocale();
  const tc = useTranslations('common');

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState<RenderedQuestionnaire | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/events/${encodeURIComponent(eventSlug)}/questionnaires/${placement}`,
          { cache: 'no-store' }
        );
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          onNotFound?.();
          return;
        }
        if (res.ok) {
          setQ(await res.json());
        } else {
          setError('Impossibile caricare il questionario.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventSlug, placement, onNotFound]);

  const setValue = useCallback((id: string, v: Value) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  const submit = useCallback(async () => {
    if (!q) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = q.items
        .map((it) => {
          const v = values[it.id];
          if (!v) return null;
          switch (it.type) {
            case 'OPEN_TEXT':
              return { itemId: it.id, valueText: v.text ?? '' };
            case 'SINGLE_CHOICE':
            case 'MULTI_CHOICE':
              return { itemId: it.id, valueChoices: v.choices ?? [] };
            case 'YES_NO':
            case 'LIKERT':
              return { itemId: it.id, valueScale: v.scale ?? null };
          }
        })
        .filter(Boolean);

      const res = await fetch(
        `/api/events/${encodeURIComponent(eventSlug)}/questionnaires/${placement}/responses`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers,
            ...(accessToken && { accessToken }),
            ...(guestId && { guestId }),
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? 'Invio fallito');
        return;
      }
      setSubmitted(true);
      onSubmitted?.();
    } finally {
      setSubmitting(false);
    }
  }, [q, values, eventSlug, placement, accessToken, guestId, onSubmitted]);

  if (loading) return <div className="text-muted">{tc('loading')}</div>;
  // Surface a load failure (non-404 error) instead of returning null, which
  // would otherwise leave the post-event modal chrome with an empty body.
  if (error && !q) {
    return (
      <div className="alert alert-danger" role="alert">
        {error}
      </div>
    );
  }
  if (notFound || !q) return null;
  if (submitted) {
    return (
      <div className="alert alert-success" role="alert">
        {submittedMessage ?? 'Grazie per le tue risposte.'}
      </div>
    );
  }

  const showHeader = !hideHeader;

  return (
    <div>
      {showHeader && (q.title[locale] || q.title.it) ? (
        <h5 className="fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
          {localize(q.title, locale)}
        </h5>
      ) : null}
      {showHeader && (q.description[locale] || q.description.it) ? (
        <p className="text-secondary mb-3" style={{ fontSize: '0.9rem' }}>
          {localize(q.description, locale)}
        </p>
      ) : null}

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      <div className="d-flex flex-column gap-3">
        {q.items.map((it) => (
          <ItemInput
            key={it.id}
            item={it}
            locale={locale}
            variant={variant}
            value={values[it.id]}
            onChange={(v) => setValue(it.id, v)}
          />
        ))}
      </div>

      <div className="mt-3">
        <Button color="primary" onClick={submit} disabled={submitting}>
          {submitting
            ? (submittingLabel ?? tc('loading'))
            : (submitLabel ?? 'Invia risposte')}
        </Button>
      </div>
    </div>
  );
}

function ItemInput({
  item,
  locale,
  variant,
  value,
  onChange,
}: {
  item: RenderedItem;
  locale: string;
  variant: 'default' | 'feedback';
  value: Value | undefined;
  onChange: (v: Value) => void;
}) {
  const prompt = localize(item.prompt, locale);

  switch (item.type) {
    case 'OPEN_TEXT':
      return (
        <div>
          <Label>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <textarea
            className="form-control"
            rows={3}
            maxLength={2000}
            value={value?.text ?? ''}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
      );
    case 'SINGLE_CHOICE':
      return (
        <div>
          <Label>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <div>
            {(item.options ?? []).map((opt, idx) => (
              <div key={idx} className="form-check">
                <input
                  className="form-check-input"
                  type="radio"
                  name={`q-${item.id}`}
                  id={`q-${item.id}-${idx}`}
                  checked={value?.choices?.[0] === idx}
                  onChange={() => onChange({ choices: [idx] })}
                />
                <label className="form-check-label" htmlFor={`q-${item.id}-${idx}`}>
                  {localize(opt, locale)}
                </label>
              </div>
            ))}
          </div>
        </div>
      );
    case 'MULTI_CHOICE':
      return (
        <div>
          <Label>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <div>
            {(item.options ?? []).map((opt, idx) => {
              const checked = (value?.choices ?? []).includes(idx);
              return (
                <div key={idx} className="form-check">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`q-${item.id}-${idx}`}
                    checked={checked}
                    onChange={(e) => {
                      const current = value?.choices ?? [];
                      onChange({
                        choices: e.target.checked
                          ? [...current, idx]
                          : current.filter((x) => x !== idx),
                      });
                    }}
                  />
                  <label className="form-check-label" htmlFor={`q-${item.id}-${idx}`}>
                    {localize(opt, locale)}
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      );
    case 'YES_NO':
      return (
        <div>
          <Label>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <div className="d-flex gap-3">
            {[
              { value: 1, label: 'Sì' },
              { value: 0, label: 'No' },
            ].map((opt) => (
              <div className="form-check" key={opt.value}>
                <input
                  className="form-check-input"
                  type="radio"
                  name={`q-${item.id}`}
                  id={`q-${item.id}-${opt.value}`}
                  checked={value?.scale === opt.value}
                  onChange={() => onChange({ scale: opt.value })}
                />
                <label className="form-check-label" htmlFor={`q-${item.id}-${opt.value}`}>
                  {opt.label}
                </label>
              </div>
            ))}
          </div>
        </div>
      );
    case 'LIKERT': {
      const min = item.scaleMin ?? 1;
      const max = item.scaleMax ?? 5;
      // Star scale in the feedback variant for the canonical 1..N rating.
      if (variant === 'feedback' && min === 1 && max >= 2 && max <= 10) {
        return (
          <div>
            <Label className="d-block mb-2">
              {prompt}
              {item.required && <span className="text-danger"> *</span>}
            </Label>
            <StarScale
              max={max}
              value={value?.scale}
              onChange={(n) => onChange({ scale: n })}
              ariaLabel={prompt}
              minLabel={item.scaleMinLabel ? localize(item.scaleMinLabel, locale) : null}
              maxLabel={item.scaleMaxLabel ? localize(item.scaleMaxLabel, locale) : null}
            />
          </div>
        );
      }
      const range = [];
      for (let i = min; i <= max; i++) range.push(i);
      return (
        <div>
          <Label>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <div className="d-flex gap-2 flex-wrap">
            {range.map((n) => (
              <div className="form-check" key={n}>
                <input
                  className="form-check-input"
                  type="radio"
                  name={`q-${item.id}`}
                  id={`q-${item.id}-${n}`}
                  checked={value?.scale === n}
                  onChange={() => onChange({ scale: n })}
                />
                <label className="form-check-label" htmlFor={`q-${item.id}-${n}`}>
                  {n}
                </label>
              </div>
            ))}
          </div>
        </div>
      );
    }
  }
}

/**
 * Star rating control. Inline SVG (not design-react-kit <Icon>) to stay
 * hydration-safe in components that may render on every page.
 */
function StarScale({
  max,
  value,
  onChange,
  ariaLabel,
  minLabel,
  maxLabel,
}: {
  max: number;
  value: number | undefined;
  onChange: (n: number) => void;
  ariaLabel?: string;
  minLabel: string | null;
  maxLabel: string | null;
}) {
  const [hover, setHover] = useState(0);
  const active = hover || value || 0;
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div style={{ maxWidth: max * 40 }}>
      {/* Toggle-button group (not a radiogroup) — each star carries an
          "n/max" accessible name and the group is named by its prompt. */}
      <div
        className="d-flex gap-1 align-items-center"
        role="group"
        aria-label={ariaLabel}
      >
        {stars.map((n) => (
          <button
            key={n}
            type="button"
            className="btn btn-link p-0 border-0 lh-1"
            aria-label={`${n}/${max}`}
            aria-pressed={value === n}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(0)}
            onClick={() => onChange(n)}
          >
            <StarIcon filled={n <= active} />
          </button>
        ))}
      </div>
      {(minLabel || maxLabel) && (
        <div
          className="d-flex justify-content-between text-muted mt-1"
          style={{ fontSize: '0.75rem' }}
        >
          <span>{minLabel ?? ''}</span>
          <span>{maxLabel ?? ''}</span>
        </div>
      )}
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill={filled ? '#FFB400' : 'none'}
      stroke={filled ? '#FFB400' : '#b1b1b3'}
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path
        strokeLinejoin="round"
        strokeLinecap="round"
        d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 18.6 6.09 21.7l1.13-6.57L2.45 9.54l6.6-.96z"
      />
    </svg>
  );
}

function localize(obj: Record<string, string>, locale: string): string {
  if (obj[locale]) return obj[locale];
  if (obj.it) return obj.it;
  const first = Object.values(obj)[0];
  return first ?? '';
}
