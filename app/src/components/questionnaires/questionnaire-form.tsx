'use client';

/**
 * Renders a questionnaire (fetched from the public endpoint) and submits
 * the participant's answers. Usable for both PRE_REGISTRATION (called
 * after a successful registration — passing accessToken) and POST_EVENT
 * (called from the thank-you page).
 *
 * Keeps UI deliberately minimal: each item type renders a native control.
 * Localizes prompts/options using the current next-intl locale, falling
 * back to Italian then the first available locale.
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
  /** Callback fired after a successful submission. */
  onSubmitted?: () => void;
}

export default function QuestionnaireForm({
  eventSlug,
  placement,
  accessToken,
  guestId,
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
          { cache: 'no-store' },
        );
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
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
  }, [eventSlug, placement]);

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
        },
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
  if (notFound || !q) return null;
  if (submitted) {
    return (
      <div className="alert alert-success" role="alert">
        Grazie per le tue risposte.
      </div>
    );
  }

  return (
    <div>
      {q.title[locale] || q.title.it ? (
        <h5 className="fw-semibold mb-1" style={{ color: '#17324D' }}>
          {localize(q.title, locale)}
        </h5>
      ) : null}
      {q.description[locale] || q.description.it ? (
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
            value={values[it.id]}
            onChange={(v) => setValue(it.id, v)}
          />
        ))}
      </div>

      <div className="mt-3">
        <Button color="primary" onClick={submit} disabled={submitting}>
          {submitting ? tc('loading') : 'Invia risposte'}
        </Button>
      </div>
    </div>
  );
}

function ItemInput({
  item,
  locale,
  value,
  onChange,
}: {
  item: RenderedItem;
  locale: string;
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

function localize(obj: Record<string, string>, locale: string): string {
  if (obj[locale]) return obj[locale];
  if (obj.it) return obj.it;
  const first = Object.values(obj)[0];
  return first ?? '';
}
