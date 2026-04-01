'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

interface PollCreateFormProps {
  eventSlug: string;
  token: string;
  onCreated: () => void;
  onCancel: () => void;
}

export default function PollCreateForm({
  eventSlug,
  token,
  onCreated,
  onCancel,
}: PollCreateFormProps) {
  const t = useTranslations('polls');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addOption = useCallback(() => {
    if (options.length < 6) {
      setOptions([...options, '']);
    }
  }, [options]);

  const removeOption = useCallback(
    (index: number) => {
      if (options.length > 2) {
        setOptions(options.filter((_, i) => i !== index));
      }
    },
    [options],
  );

  const updateOption = useCallback(
    (index: number, value: string) => {
      const updated = [...options];
      updated[index] = value;
      setOptions(updated);
    },
    [options],
  );

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');

      const trimmedOptions = options.map((o) => o.trim()).filter((o) => o.length > 0);
      if (question.trim().length < 3) {
        setError(t('errors.questionRequired'));
        return;
      }
      if (trimmedOptions.length < 2) {
        setError(t('errors.minOptions'));
        return;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/polls`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question: question.trim(),
            options: trimmedOptions,
          }),
        });

        if (!res.ok) {
          setError(t('errors.generic'));
          return;
        }

        onCreated();
      } catch {
        setError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [question, options, eventSlug, token, t, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className="border rounded p-2">
      <div className="mb-2">
        <input
          type="text"
          className="form-control form-control-sm"
          placeholder={t('questionPlaceholder')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
        />
      </div>

      {options.map((opt, i) => (
        <div key={i} className="d-flex gap-1 mb-1">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder={t('optionPlaceholder', { number: i + 1 })}
            value={opt}
            onChange={(e) => updateOption(i, e.target.value)}
            maxLength={200}
          />
          {options.length > 2 && (
            <button
              type="button"
              className="btn btn-sm btn-outline-danger border-0"
              onClick={() => removeOption(i)}
              aria-label={t('removeOption')}
            >
              <Icon icon="it-close" size="xs" />
            </button>
          )}
        </div>
      ))}

      {options.length < 6 && (
        <button
          type="button"
          className="btn btn-sm btn-link p-0 mb-2"
          onClick={addOption}
        >
          + {t('addOption')}
        </button>
      )}

      {error && <div className="text-danger small mb-2">{error}</div>}

      <div className="d-flex gap-2">
        <Button color="primary" size="xs" type="submit" disabled={submitting}>
          {submitting ? t('creating') : t('create')}
        </Button>
        <Button color="secondary" outline size="xs" type="button" onClick={onCancel}>
          {t('cancelCreate')}
        </Button>
      </div>
    </form>
  );
}
