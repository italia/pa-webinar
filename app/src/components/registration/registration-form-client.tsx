'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Alert,
  Input,
  FormGroup,
  Label,
  Icon,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { createRegistrationSchema } from '@/lib/validation/schemas';

interface RegistrationFormClientProps {
  eventSlug: string;
  privacyPolicyUrl: string;
}

type FieldErrors = Partial<Record<'displayName' | 'email' | 'consentGiven', string>>;

export default function RegistrationFormClient({
  eventSlug,
  privacyPolicyUrl,
}: RegistrationFormClientProps) {
  const t = useTranslations('registration');
  const tc = useTranslations('common');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const validate = useCallback(() => {
    const result = createRegistrationSchema.safeParse({
      displayName,
      email,
      consentGiven,
    });

    if (result.success) {
      setErrors({});
      return true;
    }

    const fieldErrors: FieldErrors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as keyof FieldErrors;
      if (!fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    setErrors(fieldErrors);
    return false;
  }, [displayName, email, consentGiven]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');

      if (!validate()) return;

      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${eventSlug}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName, email, consentGiven }),
        });

        if (res.status === 409) {
          const data = await res.json();
          if (data.error === 'already_registered') {
            setServerError(t('alreadyRegistered'));
          } else if (data.error === 'event_full') {
            setServerError(t('errors.eventFull'));
          } else {
            setServerError(t('errors.generic'));
          }
          return;
        }

        if (!res.ok) {
          setServerError(t('errors.generic'));
          return;
        }

        setSuccess(true);
      } catch {
        setServerError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [displayName, email, consentGiven, eventSlug, validate, t],
  );

  if (success) {
    return (
      <div className="text-center py-4">
        <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
        <h2 className="h3 mb-3">{t('success')}</h2>
        <p className="mb-4">{t('successMessage')}</p>
        <Link href={`/eventi/${eventSlug}`}>
          <Button color="primary" outline tag="span">
            {t('backToEvent')}
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {serverError && (
        <Alert color="danger" className="mb-4">
          {serverError}
        </Alert>
      )}

      <FormGroup className="mb-4">
        <Input
          type="text"
          id="displayName"
          label={t('name')}
          placeholder={t('namePlaceholder')}
          value={displayName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDisplayName(e.target.value)
          }
          valid={!errors.displayName && displayName.length > 0}
          {...(errors.displayName ? { validationText: t('errors.nameRequired') } : {})}
        />
      </FormGroup>

      <FormGroup className="mb-4">
        <Input
          type="email"
          id="email"
          label={t('email')}
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setEmail(e.target.value)
          }
          valid={!errors.email && email.length > 0}
          {...(errors.email ? { validationText: t('errors.emailInvalid') } : {})}
        />
      </FormGroup>

      <FormGroup check className="mb-4">
        <Input
          type="checkbox"
          id="consentGiven"
          checked={consentGiven}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setConsentGiven(e.target.checked)
          }
        />
        <Label for="consentGiven" check>
          {t('gdprConsent')}{' '}
          <a
            href={privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('gdprLink')}
          </a>
        </Label>
        {errors.consentGiven && (
          <div className="text-danger small mt-1">
            {t('errors.consentRequired')}
          </div>
        )}
      </FormGroup>

      <Button
        color="primary"
        type="submit"
        disabled={submitting}
        className="me-3"
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>

      <Link href={`/eventi/${eventSlug}`}>
        <Button color="secondary" outline tag="span">
          {tc('cancel')}
        </Button>
      </Link>
    </form>
  );
}
