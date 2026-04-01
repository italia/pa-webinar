'use client';

import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Alert, Icon } from 'design-react-kit';

const MAX_LENGTH = 500;
const COOLDOWN_SECONDS = 30;

interface QuestionFormProps {
  eventSlug: string;
  token: string;
  onSubmitted: () => void;
}

export default function QuestionForm({
  eventSlug,
  token,
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
          body: JSON.stringify({ text: text.trim(), accessToken: token }),
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
    [text, eventSlug, token, t, startCooldown, onSubmitted],
  );

  const remaining = MAX_LENGTH - text.length;

  return (
    <form onSubmit={handleSubmit} className="mb-3">
      {success && (
        <Alert color="success" className="py-2 mb-2">
          <Icon icon="it-check" size="sm" className="me-1" />
          {t('questionSent')}
        </Alert>
      )}

      {error && (
        <Alert color="danger" className="py-2 mb-2">
          {error}
        </Alert>
      )}

      <div className="mb-2">
        <textarea
          className="form-control"
          rows={2}
          maxLength={MAX_LENGTH}
          placeholder={t('placeholder')}
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
        size="sm"
        type="submit"
        disabled={submitting || cooldown > 0 || text.trim().length < 3}
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
