'use client';

import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Alert } from 'design-react-kit';

const MAX_LENGTH = 500;
const COOLDOWN_SECONDS = 30;

interface QuestionFormProps {
  eventSlug: string;
  token: string;
  /** Guest display name (from waiting-room). Used when `token` is empty
   *  so anonymous attendees can still post questions. */
  guestName?: string;
  onSubmitted: () => void;
}

export default function QuestionForm({
  eventSlug,
  token,
  guestName,
  onSubmitted,
}: QuestionFormProps) {
  const t = useTranslations('qa');

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');
      setSuccess(false);

      if (text.trim().length < 3) {
        setError(t('errors.textRequired'));
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/questions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text.trim(),
            ...(token ? { accessToken: token } : { guestName }),
          }),
        });

        if (res.status === 429) {
          setError(t('errors.rateLimit'));
          return;
        }

        if (!res.ok) {
          setError(t('errors.generic'));
          return;
        }

        setText('');
        setSuccess(true);
        startCooldown();
        onSubmitted();

        setTimeout(() => setSuccess(false), 3000);
      } catch {
        setError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [text, eventSlug, token, guestName, t, startCooldown, onSubmitted],
  );

  const remaining = MAX_LENGTH - text.length;

  return (
    <form onSubmit={handleSubmit} className="mb-3">
      {success && (
        <Alert color="success" className="py-2 mb-2">
          {t('questionSent')}
        </Alert>
      )}

      {error && (
        <Alert color="danger" className="py-2 mb-2">
          {error}
        </Alert>
      )}

      <div className="mb-2">
        <label
          htmlFor="qa-question-textarea"
          className="form-label fw-semibold mb-1"
        >
          {t('yourQuestionLabel')}
        </label>
        <textarea
          id="qa-question-textarea"
          className="form-control"
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder={t('placeholderInviting')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={submitting || cooldown > 0}
        />
        <div className="d-flex justify-content-between mt-1">
          <small className={remaining < 50 ? 'text-danger' : 'text-muted'}>
            {remaining}/{MAX_LENGTH}
          </small>
          {cooldown > 0 && (
            <small className="text-muted">
              {t('cooldownWait', { seconds: cooldown })}
            </small>
          )}
        </div>
      </div>

      <Button
        color="primary"
        type="submit"
        className="w-100 d-flex align-items-center justify-content-center gap-2"
        disabled={submitting || cooldown > 0 || text.trim().length < 3}
      >
        {/* Inline SVG instead of <Icon> to avoid design-react-kit
            hydration mismatches inside interactive forms. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
        {submitting ? t('submitting') : t('submitPrimary')}
      </Button>
    </form>
  );
}
