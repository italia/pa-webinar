'use client';

/**
 * Renders a questionnaire (fetched from the public endpoint) and submits
 * the participant's answers. Usable for both PRE_REGISTRATION and
 * POST_EVENT (called from the post-event flow / call-exit feedback modal).
 * Inside the registration form it runs `embedded`: no button of its own,
 * the answers go up to the form and travel with the registration.
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
 * thank-you, loading) can be passed in by the caller so the surrounding UI
 * owns the wording; otherwise they come from the `questionnaire` messages,
 * like the error texts and the yes/no options.
 */

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, Label } from 'design-react-kit';

import { rispostaVuota } from '@/lib/questionnaires/answers';
import type { QuestionnaireAnswerInput } from '@/lib/validation/schemas';

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

export interface RenderedQuestionnaire {
  id: string;
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  title: Record<string, string>;
  description: Record<string, string>;
  required?: boolean;
  items: RenderedItem[];
}

type Value = { text?: string; choices?: number[]; scale?: number };

/** Lo stato delle risposte, per chi incorpora il questionario. */
export interface QuestionnaireState {
  /** Le risposte date, senza quelle vuote. */
  answers: QuestionnaireAnswerInput[];
  /** Il questionario va compilato per iscriversi. */
  required: boolean;
  /** Domande obbligatorie ancora senza risposta. */
  missing: number;
}

/** La risposta a una domanda, nella forma delle rotte. */
function rispostaDa(it: RenderedItem, v: Value | undefined): QuestionnaireAnswerInput {
  switch (it.type) {
    case 'OPEN_TEXT':
      return { itemId: it.id, valueText: v?.text ?? '' };
    case 'SINGLE_CHOICE':
    case 'MULTI_CHOICE':
      return { itemId: it.id, valueChoices: v?.choices ?? [] };
    case 'YES_NO':
    case 'LIKERT':
      return { itemId: it.id, valueScale: v?.scale ?? null };
  }
}

/** Le risposte date, senza quelle vuote (la regola della rotta). */
function risposteDa(
  q: RenderedQuestionnaire,
  values: Record<string, Value>,
): QuestionnaireAnswerInput[] {
  return q.items.map((it) => rispostaDa(it, values[it.id])).filter((r) => !rispostaVuota(r));
}

export interface QuestionnaireFormProps {
  eventSlug: string;
  placement: 'PRE_REGISTRATION' | 'POST_EVENT';
  /** One of these is required to identify the respondent. */
  accessToken?: string;
  guestId?: string;
  /** Il token della sala ricevuto entrando: per la valutazione di fine evento
   *  prova la presenza di chi non e' iscritto (lib/feedback/participation). */
  roomToken?: string;
  /** Il link della valutazione dell'email di ringraziamento (lib/feedback/rating-link). */
  ratingToken?: string;
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
  /** Chi aveva gia' risposto (409): il chiamante lo dice come un esito, non
   *  come un errore. Senza, resta il messaggio d'errore. */
  onAlreadySubmitted?: () => void;
  /** Il questionario gia' letto dal server: niente lettura dal browser. */
  questionnaire?: RenderedQuestionnaire;
  /** Dentro un altro modulo: niente pulsante proprio, e lo stato delle
   *  risposte sale a ogni cambio (e al caricamento). */
  embedded?: {
    onChange: (state: QuestionnaireState) => void;
    /** Id dell'errore che il modulo mostra sul questionario. */
    errorId?: string;
    /** Il modulo ha un errore sul questionario: il gruppo lo mostra. */
    invalid?: boolean;
    /** Il segno «obbligatorio» del modulo, accanto al titolo quando serve. */
    requiredMark?: ReactNode;
  };
}

export default function QuestionnaireForm({
  eventSlug,
  placement,
  accessToken,
  guestId,
  roomToken,
  ratingToken,
  variant = 'default',
  hideHeader = false,
  submitLabel,
  submittingLabel,
  submittedMessage,
  onNotFound,
  onSubmitted,
  onAlreadySubmitted,
  questionnaire,
  embedded,
}: QuestionnaireFormProps) {
  const locale = useLocale();
  const tc = useTranslations('common');
  const tq = useTranslations('questionnaire');

  const [loading, setLoading] = useState(!questionnaire);
  const [q, setQ] = useState<RenderedQuestionnaire | null>(questionnaire ?? null);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const hintId = useId();

  useEffect(() => {
    if (questionnaire) return;
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
          setError(tq('loadFailed'));
        }
      } catch {
        // Rete assente o risposta illeggibile: lo si dice invece di lasciare
        // un riquadro vuoto.
        if (!cancelled) setError(tq('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventSlug, placement, onNotFound, tq, questionnaire]);

  const setValue = useCallback((id: string, v: Value) => {
    setValues((prev) => ({ ...prev, [id]: v }));
  }, []);

  // Incorporato: il modulo che lo contiene riceve le risposte a ogni cambio.
  const onEmbeddedChange = embedded?.onChange;
  useEffect(() => {
    if (!q || !onEmbeddedChange) return;
    onEmbeddedChange({
      answers: risposteDa(q, values),
      required: q.required ?? false,
      missing: q.items.filter((it) => it.required && rispostaVuota(rispostaDa(it, values[it.id])))
        .length,
    });
  }, [q, values, onEmbeddedChange]);

  const submit = useCallback(async () => {
    if (!q) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = risposteDa(q, values);

      const res = await fetch(
        `/api/events/${encodeURIComponent(eventSlug)}/questionnaires/${placement}/responses`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            answers,
            ...(accessToken && { accessToken }),
            ...(guestId && { guestId }),
            ...(roomToken && { roomToken }),
            ...(ratingToken && { ratingToken }),
          }),
        }
      );
      if (!res.ok) {
        // Il messaggio del server e' tecnico e in inglese: chi risponde legge
        // una frase nella propria lingua, scelta dal codice dell'errore.
        const err = (await res.json().catch(() => ({}))) as { code?: string };
        if (err.code === 'ALREADY_SUBMITTED' && onAlreadySubmitted) {
          onAlreadySubmitted();
          return;
        }
        setError(
          err.code === 'VALIDATION_ERROR'
            ? tq('answersInvalid')
            : err.code === 'ALREADY_SUBMITTED'
              ? tq('alreadySubmitted')
              : err.code === 'NOT_A_PARTICIPANT'
                ? tq('onlyParticipants')
                : tq('submitFailed'),
        );
        return;
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setError(tq('submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [q, values, eventSlug, placement, accessToken, guestId, roomToken, ratingToken, onSubmitted, onAlreadySubmitted, tq]);

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
        {submittedMessage ?? tq('thankYou')}
      </div>
    );
  }

  const domande = q.items.map((it) => (
    <ItemInput
      key={it.id}
      item={it}
      locale={locale}
      variant={variant}
      value={values[it.id]}
      onChange={(v) => setValue(it.id, v)}
    />
  ));

  // Dentro il modulo d'iscrizione: un gruppo del modulo, con il suo titolo,
  // senza pulsante; l'errore lo mostra il modulo.
  if (embedded) {
    const descrizione = localize(q.description, locale);
    return (
      <fieldset
        className={`registration-questionnaire mb-4${embedded.invalid ? ' registration-questionnaire--error' : ''}`}
        aria-describedby={embedded.errorId}
        tabIndex={-1}
      >
        <legend className="registration-consents__legend">
          {localize(q.title, locale) || tq('pageTitle')}
          {q.required && embedded.requiredMark ? <> {embedded.requiredMark}</> : null}
        </legend>
        {descrizione && (
          <p className="text-secondary mb-3" style={{ fontSize: '0.9rem' }}>
            {descrizione}
          </p>
        )}
        <div className="d-flex flex-column gap-3">{domande}</div>
      </fieldset>
    );
  }

  const showHeader = !hideHeader;
  // Nella valutazione si invia dopo almeno una risposta: un invio vuoto non
  // dice niente a chi organizza e consuma l'unica risposta concessa.
  const nessunaRisposta =
    variant === 'feedback' &&
    !Object.values(values).some(
      (v) => v.scale != null || (v.text ?? '').trim() !== '' || (v.choices ?? []).length > 0,
    );

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

      <div className={variant === 'feedback' ? 'qf-feedback' : 'd-flex flex-column gap-3'}>
        {domande}
      </div>

      <div className={variant === 'feedback' ? 'qf-feedback__submit' : 'mt-3'}>
        <Button
          color="primary"
          onClick={submit}
          disabled={submitting || nessunaRisposta}
          aria-describedby={nessunaRisposta ? hintId : undefined}
        >
          {submitting
            ? (submittingLabel ?? tc('loading'))
            : (submitLabel ?? tq('submit'))}
        </Button>
        {nessunaRisposta && (
          <p className="qf-feedback__hint" id={hintId}>
            {tq('answerOne')}
          </p>
        )}
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
  const tq = useTranslations('questionnaire');
  const prompt = localize(item.prompt, locale);

  switch (item.type) {
    case 'OPEN_TEXT':
      if (variant === 'feedback') {
        const testo = value?.text ?? '';
        return (
          <div className="qf-item qf-item--text">
            <label className="qf-item__prompt" htmlFor={`q-${item.id}`}>
              {prompt}
              {item.required && <span className="text-danger"> *</span>}
            </label>
            <textarea
              id={`q-${item.id}`}
              className="form-control qf-item__textarea"
              rows={3}
              maxLength={2000}
              value={testo}
              onChange={(e) => onChange({ text: e.target.value })}
            />
            {testo.length > 1500 && <span className="qf-item__count">{testo.length}/2000</span>}
          </div>
        );
      }
      return (
        <div>
          <Label htmlFor={`q-${item.id}`}>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <textarea
            id={`q-${item.id}`}
            className="form-control"
            rows={3}
            maxLength={2000}
            aria-required={item.required || undefined}
            value={value?.text ?? ''}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
      );
    case 'SINGLE_CHOICE':
      return (
        <div
          role="radiogroup"
          aria-labelledby={`q-${item.id}-titolo`}
          aria-required={item.required || undefined}
        >
          <Label id={`q-${item.id}-titolo`}>
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
        <div role="group" aria-labelledby={`q-${item.id}-titolo`}>
          <Label id={`q-${item.id}-titolo`}>
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
        <div
          role="radiogroup"
          aria-labelledby={`q-${item.id}-titolo`}
          aria-required={item.required || undefined}
        >
          <Label id={`q-${item.id}-titolo`}>
            {prompt}
            {item.required && <span className="text-danger"> *</span>}
          </Label>
          <div className="d-flex gap-3">
            {[
              { value: 1, label: tq('yes') },
              { value: 0, label: tq('no') },
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
          <div className="qf-item qf-item--scale">
            <span className="qf-item__prompt">
              {prompt}
              {item.required && <span className="text-danger"> *</span>}
            </span>
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
        <div
          role="radiogroup"
          aria-labelledby={`q-${item.id}-titolo`}
          aria-required={item.required || undefined}
        >
          <Label id={`q-${item.id}-titolo`}>
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
  const tq = useTranslations('questionnaire');
  const [hover, setHover] = useState(0);
  const active = hover || value || 0;
  const stars = Array.from({ length: max }, (_, i) => i + 1);
  return (
    <div className="qf-stars">
      <div className="qf-stars__row">
        {/* Toggle-button group (not a radiogroup) — each star carries an
            "n/max" accessible name and the group is named by its prompt. */}
        <div className="qf-stars__buttons" role="group" aria-label={ariaLabel}>
          {stars.map((n) => (
            <button
              key={n}
              type="button"
              className={`qf-stars__star${n <= active ? ' is-on' : ''}`}
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
        <span className="qf-stars__value" aria-hidden="true">
          {value ? tq('scaleValue', { value, max }) : ''}
        </span>
      </div>
      {(minLabel || maxLabel) && (
        <div className="qf-stars__labels" style={{ width: `${max * 44}px` }}>
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
      width="32"
      height="32"
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
