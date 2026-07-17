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
  Spinner,
} from 'design-react-kit';

import { Link, useRouter } from '@/i18n/navigation';
import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';
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
  multitrackRecordingEnabled?: boolean;
  /** When the event has a PRE_REGISTRATION questionnaire, the success
   *  screen must show it (and stay put) instead of auto-redirecting the
   *  user into the waiting room. */
  hasPreRegistrationQuestionnaire?: boolean;
  /** Event start (ISO). Routing (#1): registering within waitingRoomLeadMinutes
   *  of start → straight to the waiting room; registering earlier → thank-you. */
  startsAt: string;
  /** Minutes before startsAt inside which we route into the waiting room
   *  (SiteSetting.waitingRoomLeadMinutes). */
  waitingRoomLeadMinutes: number;
  profiling?: ProfilingConfig;
}

type FieldErrors = Partial<Record<string, string>>;

export default function RegistrationFormClient({
  eventSlug,
  privacyPolicyUrl,
  privacyPolicyText,
  recordingEnabled,
  multitrackRecordingEnabled,
  hasPreRegistrationQuestionnaire,
  startsAt,
  waitingRoomLeadMinutes,
  profiling,
}: RegistrationFormClientProps) {
  const t = useTranslations('registration');
  const tg = useTranslations('gdpr');
  const tc = useTranslations('common');
  const tlive = useTranslations('live');
  const router = useRouter();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [organizationRole, setOrganizationRole] = useState('');
  const [organizationType, setOrganizationType] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentRecording, setConsentRecording] = useState(false);
  const [consentMultitrack, setConsentMultitrack] = useState(false);
  const [consentFutureCommunications, setConsentFutureCommunications] = useState(false);
  // Rubrica (address book) opt-in — separate Art. 6.1.a consent from the
  // event-registration Art. 6.1.b basis. Default unchecked, as GDPR
  // requires an affirmative act.
  const [consentAddressBook, setConsentAddressBook] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);

  const [orgSuggestions, setOrgSuggestions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [registrationAccessToken, setRegistrationAccessToken] = useState<string | null>(null);
  // Duplicate sign-up: offer to re-send the original access link instead
  // of leaving the user stuck on a generic error.
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

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
      consentAddressBook,
    };
    if (recordingEnabled) payload.consentRecording = consentRecording;
    if (multitrackRecordingEnabled) payload.consentMultitrack = consentMultitrack;
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
    // Multitrack consent is mandatory when per-participant recording is enabled
    if (multitrackRecordingEnabled && !consentMultitrack) {
      fieldErrors.consentMultitrack = 'registration.errors.multitrackConsentRequired';
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }, [displayName, email, consentGiven, consentRecording, consentMultitrack, consentFutureCommunications, consentAddressBook, organization, organizationRole, organizationType, showOrg, showRole, showType, recordingEnabled, multitrackRecordingEnabled]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setServerError('');
      setAlreadyRegistered(false);
      setResent(false);

      if (!validate()) return;

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          displayName, email, consentGiven,
          consentFutureCommunications,
          consentAddressBook,
        };
        if (recordingEnabled) body.consentRecording = consentRecording;
        if (multitrackRecordingEnabled) body.consentMultitrack = consentMultitrack;
        if (showOrg && organization) body.organization = organization;
        if (showRole && organizationRole) body.organizationRole = organizationRole;
        if (showType && organizationType) body.organizationType = organizationType;

        const res = await fetch(`/api/events/${eventSlug}/registrations`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));
          // The API now tags a duplicate sign-up with the dedicated
          // ALREADY_REGISTERED code (errors.ts). Any other 409 here
          // (e.g. the event flipped out of PUBLISHED/LIVE between page
          // load and submit) stays generic.
          if (data.code === 'ALREADY_REGISTERED') {
            setServerError(t('alreadyRegistered'));
            setAlreadyRegistered(true);
          } else {
            setServerError(t('errors.generic'));
          }
          return;
        }

        if (!res.ok) {
          setServerError(t('errors.generic'));
          return;
        }

        const regData = await res.json().catch(() => ({}));
        if (regData?.accessToken) {
          setRegistrationAccessToken(regData.accessToken);
        }
        setSuccess(true);
      } catch {
        setServerError(t('errors.generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [displayName, email, consentGiven, consentRecording, consentMultitrack, consentFutureCommunications, consentAddressBook, organization, organizationRole, organizationType, eventSlug, validate, t, showOrg, showRole, showType, recordingEnabled, multitrackRecordingEnabled],
  );

  // Duplicate sign-up recovery: re-send the original confirmation email
  // (with the personal join link). The endpoint always answers 200 with a
  // neutral body, so this never reveals whether the address is registered.
  const handleResend = useCallback(async () => {
    setResending(true);
    try {
      await fetch(`/api/events/${eventSlug}/registrations/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } catch {
      /* leave the button live so the user can retry */
    } finally {
      setResending(false);
    }
  }, [eventSlug, email]);

  // Registration routing by time (#1): "near start" = the event begins within
  // waitingRoomLeadMinutes. Computed at call time so it stays correct while the
  // confirmation screen sits open across the threshold.
  const isNearStart = useCallback(
    () => new Date(startsAt).getTime() - Date.now() <= waitingRoomLeadMinutes * 60_000,
    [startsAt, waitingRoomLeadMinutes],
  );

  // `isNearStart()` is time-dependent, so on the confirmation screen we tick a
  // counter every 30s. This re-renders (re-evaluating nearStart in the render →
  // the enter-room button + iCal appear once the lead window is reached) AND
  // re-runs the auto-redirect effect below (nowTick is in its deps), so an early
  // registrant who keeps the tab open is pulled into the waiting room when the
  // event nears — instead of being stranded on the thank-you screen forever.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    if (!success) return;
    const id = setInterval(() => setNowTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [success]);

  // One-step access: the registration API already handed us the personal
  // accessToken, so when there's no PRE_REGISTRATION questionnaire to fill AND
  // the event is near start we send the user straight into the waiting room
  // instead of making them click "Enter room". Registering hours early instead
  // lands on the thank-you screen (with an iCal link) — see below. A short delay
  // lets the "Registration complete" confirmation register; the manual button
  // below stays as a no-JS / slow-redirect fallback.
  useEffect(() => {
    if (!success || !registrationAccessToken || hasPreRegistrationQuestionnaire) return;
    if (!isNearStart()) return;
    const target = `/events/${eventSlug}/live?token=${registrationAccessToken}`;
    const id = setTimeout(() => router.push(target), 1200);
    return () => clearTimeout(id);
  }, [success, registrationAccessToken, hasPreRegistrationQuestionnaire, eventSlug, router, isNearStart, nowTick]);

  if (success) {
    // Auto-redirect straight into the waiting room when there's nothing
    // left to do on this screen (no PRE_REGISTRATION questionnaire). When
    // a questionnaire is present we stay so the user can fill it first.
    const nearStart = isNearStart();
    const autoRedirecting = !!registrationAccessToken && !hasPreRegistrationQuestionnaire && nearStart;
    return (
      <div className="py-4">
        <div className="text-center">
          {/* Inline SVG (not design-react-kit <Icon>) — this node mounts
              right after a state change, where the icon-font <Icon> is a
              known hydration-mismatch source. */}
          <svg
            className="text-success mb-3"
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12.5l2.5 2.5L16 9" />
          </svg>
          <h2 className="h3 mb-3">{t('success')}</h2>
          <p className="mb-4">
            {autoRedirecting
              ? t('enteringRoom')
              : nearStart
                ? t('successMessage')
                : t('successScheduledMessage')}
          </p>
        </div>
        {registrationAccessToken && (
          <div className="mb-4">
            <QuestionnaireForm
              eventSlug={eventSlug}
              placement="PRE_REGISTRATION"
              accessToken={registrationAccessToken}
            />
          </div>
        )}
        {/* Immediate entry: the registration API already returned the
            personal accessToken, so we send the user straight into the
            waiting room instead of forcing them to wait for the
            confirmation email. The /live token path renders the waiting
            room for any joinable status and auto-enables entry once the
            event is LIVE — this is what was missing during the caffettino
            run (people registered but had no on-screen way in). When we
            auto-redirect, this button is the manual fallback. */}
        <div className="text-center d-flex flex-column align-items-center gap-2">
          {autoRedirecting && (
            <div className="text-muted mb-1 d-inline-flex align-items-center" style={{ fontSize: '0.9rem' }}>
              <Spinner active small className="me-2" />
              {t('enteringRoomHint')}
            </div>
          )}
          {registrationAccessToken && nearStart && (
            <Link
              href={`/events/${eventSlug}/live?token=${registrationAccessToken}`}
            >
              <Button color="primary" size="lg" tag="span">
                {tlive('enterRoom')}
              </Button>
            </Link>
          )}
          {!nearStart && (
            <a
              href={`/api/events/${eventSlug}/calendar.ics`}
              download
              className="btn btn-outline-primary"
            >
              {t('addToCalendar')}
            </a>
          )}
          <Link href={`/events/${eventSlug}`}>
            <Button color="primary" outline tag="span">
              {t('backToEvent')}
            </Button>
          </Link>
        </div>
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

      {alreadyRegistered && (
        <div className="mb-4">
          {resent ? (
            <Alert color="success" className="mb-0">
              {t('resendSent')}
            </Alert>
          ) : (
            <Button
              color="primary"
              outline
              type="button"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? (
                <>
                  <Spinner active small className="me-2" />
                  {t('resending')}
                </>
              ) : (
                t('resendLink')
              )}
            </Button>
          )}
        </div>
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

      {/* ── Consent 2b: Multitrack per-participant recording (ADR-013 F5) ── */}
      {multitrackRecordingEnabled && (
        <FormGroup check className="mb-3">
          <Input
            type="checkbox"
            id="consentMultitrack"
            checked={consentMultitrack}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setConsentMultitrack(e.target.checked)
            }
          />
          <Label for="consentMultitrack" check>
            {tg('consent.multitrack')}
          </Label>
          {errors.consentMultitrack && (
            <div className="text-danger small mt-1">
              {tg('consent.multitrackRequired')}
            </div>
          )}
        </FormGroup>
      )}

      {/* ── Consent 3: Future communications (optional) ── */}
      <FormGroup check className="mb-3">
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

      {/* ── Consent 4: Rubrica (address book) — Art. 6.1.a opt-in ── */}
      <FormGroup check className="mb-4">
        <Input
          type="checkbox"
          id="consentAddressBook"
          checked={consentAddressBook}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setConsentAddressBook(e.target.checked)
          }
        />
        <Label for="consentAddressBook" check>
          {tg('consent.addressBook')}
        </Label>
        <div className="form-text text-muted small ms-1">
          {tg('consent.addressBookHelp')}
        </div>
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
