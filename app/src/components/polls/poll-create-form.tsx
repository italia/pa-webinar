'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';

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
    <form onSubmit={handleSubmit} className="poll-form">
      <label htmlFor="poll-question" className="poll-form__label">
        {t('questionLabel')}
      </label>
      <textarea
        id="poll-question"
        className="poll-form__input"
        rows={2}
        placeholder={t('questionPlaceholder')}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        maxLength={300}
        autoFocus
      />

      <fieldset className="poll-form__options">
        <legend className="poll-form__label">{t('optionsLabel')}</legend>
        {options.map((opt, i) => (
          <div key={i} className="poll-form__option">
            <span className="poll-form__num" aria-hidden="true">{i + 1}</span>
            <input
              type="text"
              className="poll-form__input"
              placeholder={t('optionPlaceholder', { number: i + 1 })}
              aria-label={t('optionPlaceholder', { number: i + 1 })}
              value={opt}
              onChange={(e) => updateOption(i, e.target.value)}
              maxLength={200}
            />
            {options.length > 2 && (
              <button
                type="button"
                className="poll-form__remove"
                onClick={() => removeOption(i)}
                aria-label={t('removeOption')}
                title={t('removeOption')}
              >
                <Icon icon="it-close" size="sm" />
              </button>
            )}
          </div>
        ))}
        {options.length < 6 && (
          <button type="button" className="poll-form__add" onClick={addOption}>
            <Icon icon="it-plus-circle" size="xs" color="primary" />
            {t('addOption')}
          </button>
        )}
      </fieldset>

      {error && (
        <p className="qa-error" role="alert">
          {error}
        </p>
      )}

      <div className="poll-form__actions">
        <Button color="secondary" outline size="sm" type="button" onClick={onCancel}>
          {t('cancelCreate')}
        </Button>
        <Button color="primary" size="sm" type="submit" disabled={submitting}>
          {submitting ? t('creating') : t('create')}
        </Button>
      </div>
    </form>
  );
}
