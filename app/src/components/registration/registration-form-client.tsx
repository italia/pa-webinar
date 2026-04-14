'use client';

import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
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
import { createRegistrationSchema, ORGANIZATION_TYPES } from '@/lib/validation/schemas';

interface ProfilingConfig {
  requireOrganization: boolean;
  requireOrganizationRole: boolean;
  requireOrganizationType: boolean;
}

interface RegistrationFormClientProps {
  eventSlug: string;
  privacyPolicyUrl: string;
  privacyPolicyText?: string;
  recordingEnabled?: boolean;
  profiling?: ProfilingConfig;
}

type FieldErrors = Partial<Record<string, string>>;

export default function RegistrationFormClient({
  eventSlug,
  privacyPolicyUrl,
  privacyPolicyText,
  recordingEnabled,
  profiling,
}: RegistrationFormClientProps) {
  const t = useTranslations('registration');
  const tg = useTranslations('gdpr');
  const tc = useTranslations('common');

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationRole, setOrganizationRole] = useState('');
  const [organizationType, setOrganizationType] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentRecording, setConsentRecording] = useState(false);
  const [consentFutureCommunications, setConsentFutureCommunications] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);

  const [orgSuggestions, setOrgSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const showOrg = profiling?.requireOrganization ?? false;
  const showRole = profiling?.requireOrganizationRole ?? false;
  const showType = profiling?.requireOrganizationType ?? false;

  // Autocomplete organization name
  useEffect(() => {
    if (!showOrg || organization.length < 2) {
      setOrgSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/organizations/suggestions?q=${encodeURIComponent(organization)}`);
        if (res.ok) {
          const data = await res.json();
          setOrgSuggestions(data.suggestions ?? []);
        }
      } catch { /* ignore */ }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [organization, showOrg]);

  const validate = useCallback(() => {
    const payload: Record<string, unknown> = {
      displayName,
      email,
      consentGiven,
      consentFutureCommunications,
    };
    if (recordingEnabled) payload.consentRecording = consentRecording;
    if (showOrg) payload.organization = organization || undefined;
    if (showRole) payload.organizationRole = organizationRole || undefined;
    if (showType && organizationType) payload.organizationType = organizationType;

    const result = createRegistrationSchema.safeParse(payload);

    const fieldErrors: FieldErrors = {};

    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0]);
        if (!fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
    }

    // Extra validation: if profiling fields are required by event, ensure they're filled
    if (showOrg && !organization.trim()) {
      fieldErrors.organization = 'registration.errors.organizationRequired';
    }
    // Recording consent is mandatory when recording is enabled
    if (recordingEnabled && !consentRecording) {
      fieldErrors.consentRecording = 'registration.errors.recordingConsentRequired';
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }, [displayName, email, consentGiven, consentRecording, consentFutureCommunications, organization, organizationRole, organizationType, showOrg, showRole, showType, recordingEnabled]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');

      if (!validate()) return;

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          displayName, email, consentGiven,
          consentFutureCommunications,
        };
        if (recordingEnabled) body.consentRecording = consentRecording;
        if (showOrg && organization) body.organization = organization;
        if (showRole && organizationRole) body.organizationRole = organizationRole;
        if (showType && organizationType) body.organizationType = organizationType;

        const res = await fetch(`/api/events/${eventSlug}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
    [displayName, email, consentGiven, consentRecording, consentFutureCommunications, organization, organizationRole, organizationType, eventSlug, validate, t, showOrg, showRole, showType, recordingEnabled],
  );

  if (success) {
    return (
      <div className="text-center py-4">
        <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
        <h2 className="h3 mb-3">{t('success')}</h2>
        <p className="mb-4">{t('successMessage')}</p>
        <Link href={`/events/${eventSlug}`}>
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

      {showOrg && (
        <FormGroup className="mb-4">
          <Label htmlFor="organization">{t('organization')}</Label>
          <input
            type="text"
            id="organization"
            className={`form-control${errors.organization ? ' is-invalid' : ''}`}
            placeholder={t('organizationPlaceholder')}
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            list="org-suggestions"
            autoComplete="organization"
          />
          {orgSuggestions.length > 0 && (
            <datalist id="org-suggestions">
              {orgSuggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          {errors.organization && (
            <div className="invalid-feedback d-block">
              {t('errors.organizationRequired')}
            </div>
          )}
        </FormGroup>
      )}

      {showRole && (
        <FormGroup className="mb-4">
          <Input
            type="text"
            id="organizationRole"
            label={t('organizationRole')}
            placeholder={t('organizationRolePlaceholder')}
            value={organizationRole}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setOrganizationRole(e.target.value)
            }
          />
        </FormGroup>
      )}

      {showType && (
        <FormGroup className="mb-4">
          <Label htmlFor="organizationType">{t('organizationType')}</Label>
          <select
            id="organizationType"
            className="form-select"
            value={organizationType}
            onChange={(e) => setOrganizationType(e.target.value)}
          >
            <option value="">{t('organizationTypePlaceholder')}</option>
            {ORGANIZATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`organizationTypes.${type}`)}
              </option>
            ))}
          </select>
        </FormGroup>
      )}

      {/* ── Privacy policy (inline text or link) ── */}
      {privacyPolicyText ? (
        <div className="mb-4">
          <button
            type="button"
            className="btn btn-link p-0 text-decoration-none fw-semibold"
            onClick={() => setPrivacyExpanded(!privacyExpanded)}
            style={{ fontSize: '0.9rem' }}
          >
            <Icon icon={privacyExpanded ? 'it-collapse' : 'it-expand'} size="sm" className="me-1" />
            {t('gdprLink')}
          </button>
          {privacyExpanded && (
            <div
              className="border rounded p-3 mt-2 bg-white"
              style={{ fontSize: '0.85rem', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap' }}
            >
              {privacyPolicyText}
            </div>
          )}
        </div>
      ) : (
        <div className="mb-3">
          <a
            href={privacyPolicyUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.9rem' }}
          >
            {t('gdprLink')}
          </a>
        </div>
      )}

      {/* ── Consent 1: Data processing (mandatory) ── */}
      <FormGroup check className="mb-3">
        <Input
          type="checkbox"
          id="consentGiven"
          checked={consentGiven}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setConsentGiven(e.target.checked)
          }
        />
        <Label for="consentGiven" check>
          {t('gdprConsent')}
          {(showOrg || showRole || showType) && (' ' + t('gdprConsentProfiling'))}
        </Label>
        {errors.consentGiven && (
          <div className="text-danger small mt-1">
            {t('errors.consentRequired')}
          </div>
        )}
      </FormGroup>

      {/* ── Consent 2: Recording (shown only if event has recording) ── */}
      {recordingEnabled && (
        <FormGroup check className="mb-3">
          <Input
            type="checkbox"
            id="consentRecording"
            checked={consentRecording}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setConsentRecording(e.target.checked)
            }
          />
          <Label for="consentRecording" check>
            {tg('consent.recording')}
          </Label>
          {errors.consentRecording && (
            <div className="text-danger small mt-1">
              {tg('consent.recordingRequired')}
            </div>
          )}
        </FormGroup>
      )}

      {/* ── Consent 3: Future communications (optional) ── */}
      <FormGroup check className="mb-4">
        <Input
          type="checkbox"
          id="consentFutureCommunications"
          checked={consentFutureCommunications}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setConsentFutureCommunications(e.target.checked)
          }
        />
        <Label for="consentFutureCommunications" check>
          {tg('consent.futureCommunications')}
        </Label>
      </FormGroup>

      <Button
        color="primary"
        type="submit"
        disabled={submitting}
        className="me-3"
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>

      <Link href={`/events/${eventSlug}`}>
        <Button color="secondary" outline tag="span">
          {tc('cancel')}
        </Button>
      </Link>
    </form>
  );
}
