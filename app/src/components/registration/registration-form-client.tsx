'use client';

import { useState, useCallback, useEffect, useRef, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Button,
  Alert,
  Input,
  FormGroup,
  Label,
  Spinner,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link, useRouter, percorso } from '@/i18n/navigation';
import QuestionnaireForm from '@/components/questionnaires/questionnaire-form';
import { createRegistrationSchema, ORGANIZATION_TYPES } from '@/lib/validation/schemas';
import type { RegistrationAccess } from '@/lib/events/registration-access';

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
  /** Event start (ISO). Routing: registering within waitingRoomLeadMinutes
   *  of start → straight to the waiting room; registering earlier → thank-you. */
  startsAt: string;
  /** Minutes before startsAt inside which we route into the waiting room
   *  (SiteSetting.waitingRoomLeadMinutes). */
  waitingRoomLeadMinutes: number;
  profiling?: ProfilingConfig;
  /** Chi può iscriversi (lib/events/registration-access): con l'iscrizione
   *  pubblica spenta il modulo spiega che serve l'invito e che il link arriva
   *  per email; senza invitati resta solo il rinvio del link a chi è iscritto. */
  registrationAccess?: RegistrationAccess;
}

type FieldErrors = Partial<Record<string, string>>;

/** Lo stesso controllo della rotta di rinvio del link. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  registrationAccess = 'open',
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
  // La lingua della pagina: decide la lingua delle email che seguiranno.
  const locale = useLocale();
  const formRef = useRef<HTMLFormElement>(null);
  // Un campo corretto dopo un invio fallito smette subito di risultare
  // sbagliato, invece di restare rosso fino all'invio successivo.
  const pulisciErrore = useCallback((campo: string) => {
    setErrors((prev) => (prev[campo] ? { ...prev, [campo]: undefined } : prev));
  }, []);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  // Solo su invito il server risponde allo stesso modo a chiunque e il link
  // lo manda per email: qui non si sa se l'indirizzo era fra gli invitati.
  const [linkByEmail, setLinkByEmail] = useState(false);
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

      if (!validate()) {
        // Dopo il rendering degli errori il focus va sul primo campo da
        // correggere: restando sul pulsante, chi usa un lettore di schermo non
        // saprebbe cosa non va.
        requestAnimationFrame(() => {
          formRef.current
            ?.querySelector<HTMLElement>('[aria-invalid="true"], .is-invalid')
            ?.focus();
        });
        return;
      }

      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          displayName, email, consentGiven,
          consentFutureCommunications,
          consentAddressBook,
          locale,
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

        // 202: iscrizione solo su invito. Niente token: il link arriva
        // nella casella dell'indirizzo, se è fra gli invitati.
        if (res.status === 202) {
          setLinkByEmail(true);
          setSuccess(true);
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
    [displayName, email, consentGiven, consentRecording, consentMultitrack, consentFutureCommunications, consentAddressBook, organization, organizationRole, organizationType, eventSlug, validate, t, showOrg, showRole, showType, recordingEnabled, multitrackRecordingEnabled, locale],
  );

  // Duplicate sign-up recovery: re-send the original confirmation email
  // (with the personal join link). The endpoint always answers 200 with a
  // neutral body, so this never reveals whether the address is registered.
  const handleResend = useCallback(async () => {
    setResent(false);
    setResending(true);
    try {
      await fetch(`/api/events/${eventSlug}/registrations/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      setResent(true);
    } catch {
      /* leave the button live so the user can retry */
    } finally {
      setResending(false);
    }
  }, [eventSlug, email, locale]);

  // Registration routing by time: "near start" = the event begins within
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
    const id = setTimeout(() => router.push(percorso(target)), 1200);
    return () => clearTimeout(id);
  }, [success, registrationAccessToken, hasPreRegistrationQuestionnaire, eventSlug, router, isNearStart, nowTick]);

  if (success && linkByEmail) {
    return (
      <div className="py-4 text-center">
        <h2 className="h3 mb-3">{t('checkEmailTitle')}</h2>
        <p className="mb-4">{t('checkEmail')}</p>
        <Link href={percorso(`/events/${eventSlug}`)}>
          <Button color="primary" outline tag="span">
            {t('backToEvent')}
          </Button>
        </Link>
      </div>
    );
  }

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
            event is LIVE — this is what was missing on a real run
            (people registered but had no on-screen way in). When we
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
              href={percorso(`/events/${eventSlug}/live?token=${registrationAccessToken}`)}
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
          <Link href={percorso(`/events/${eventSlug}`)}>
            <Button color="primary" outline tag="span">
              {t('backToEvent')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Iscrizione pubblica spenta e nessun invitato per l'evento: nessun nuovo
  // indirizzo verrebbe accettato, un modulo da compilare sarebbe un inganno.
  // Resta la via per chi si era iscritto prima: farsi rimandare il link, che
  // da questa pagina — dove la sala rimanda chi arriva senza — è l'unica.
  if (registrationAccess === 'closed') {
    return (
      <>
        <Alert color="info" className="mb-4">
          {t('closed')}
        </Alert>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!EMAIL_RE.test(email.trim())) {
              setErrors({ email: 'registration.errors.emailInvalid' });
              return;
            }
            setErrors({});
            void handleResend();
          }}
          noValidate
        >
          <h2 className="h5 fw-semibold mb-2">{t('lostLink')}</h2>
          <p className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
            {t('lostLinkHelp')}
          </p>
          <FormGroup className="mb-3">
            <Input
              type="email"
              id="email"
              wrapperClassName="mb-1"
              label={t('email')}
              autoComplete="email"
              required
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? 'emailError' : undefined}
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setEmail(e.target.value);
                setResent(false);
                pulisciErrore('email');
              }}
              valid={errors.email ? false : undefined}
            />
            {errors.email && (
              <div id="emailError" className="invalid-feedback d-block">
                {t('errors.emailInvalid')}
              </div>
            )}
          </FormGroup>
          {resent ? (
            <Alert color="success" className="mb-3">
              {t('resendSent')}
            </Alert>
          ) : (
            <Button color="primary" type="submit" disabled={resending} className="me-3">
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
          <Link href={percorso(`/events/${eventSlug}`)}>
            <Button color="secondary" outline tag="span">
              {t('backToEvent')}
            </Button>
          </Link>
        </form>
      </>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate>
      {registrationAccess === 'invitation' && (
        <Alert color="info" className="mb-4">
          {t('invitationOnly')}
        </Alert>
      )}

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
          // Aiuto ed errore stanno subito sotto il campo, fuori dal contenitore
          // del kit: il suo margine li staccherebbe dal campo.
          wrapperClassName="mb-1"
          label={t('name')}
          autoComplete="name"
          required
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={errors.displayName ? 'displayNameHelp displayNameError' : 'displayNameHelp'}
          value={displayName}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setDisplayName(e.target.value);
            pulisciErrore('displayName');
          }}
          // Rosso solo dopo un invio fallito: un campo ancora vuoto non e'
          // sbagliato, e la spunta verde su un'email malformata mentirebbe.
          valid={errors.displayName ? false : undefined}
        />
        <small id="displayNameHelp" className="form-text">
          {t('namePlaceholder')}
        </small>
        {errors.displayName && (
          <div id="displayNameError" className="invalid-feedback d-block">
            {t('errors.nameRequired')}
          </div>
        )}
      </FormGroup>

      <FormGroup className="mb-4">
        <Input
          type="email"
          id="email"
          // Aiuto ed errore stanno subito sotto il campo, fuori dal contenitore
          // del kit: il suo margine li staccherebbe dal campo.
          wrapperClassName="mb-1"
          label={t('email')}
          autoComplete="email"
          required
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'emailHelp emailError' : 'emailHelp'}
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setEmail(e.target.value);
            pulisciErrore('email');
          }}
          // Rosso solo dopo un invio fallito: un campo ancora vuoto non e'
          // sbagliato, e la spunta verde su un'email malformata mentirebbe.
          valid={errors.email ? false : undefined}
        />
        <small id="emailHelp" className="form-text">
          {t('emailPlaceholder')}
        </small>
        {errors.email && (
          <div id="emailError" className="invalid-feedback d-block">
            {t('errors.emailInvalid')}
          </div>
        )}
      </FormGroup>

      {showOrg && (
        <FormGroup className="mb-4">
          <Label htmlFor="organization">{t('organization')}</Label>
          <input
            type="text"
            id="organization"
            className={`form-control${errors.organization ? ' is-invalid' : ''}`}
            placeholder={t('organizationPlaceholder')}
            required
            aria-invalid={errors.organization ? true : undefined}
            aria-describedby={errors.organization ? 'organizationError' : undefined}
            value={organization}
            onChange={(e) => {
              setOrganization(e.target.value);
              pulisciErrore('organization');
            }}
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
            <div id="organizationError" className="invalid-feedback d-block">
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
          aria-invalid={errors.consentGiven ? true : undefined}
          aria-required="true"
          aria-describedby={errors.consentGiven ? 'consentGivenError' : undefined}
          checked={consentGiven}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            setConsentGiven(e.target.checked);
            pulisciErrore('consentGiven');
          }}
        />
        <Label for="consentGiven" check>
          {t('gdprConsent')}
          {(showOrg || showRole || showType) && (' ' + t('gdprConsentProfiling'))}
        </Label>
        {errors.consentGiven && (
          <div id="consentGivenError" className="text-danger small mt-1">
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
            aria-invalid={errors.consentRecording ? true : undefined}
            aria-required="true"
            aria-describedby={errors.consentRecording ? 'consentRecordingError' : undefined}
            checked={consentRecording}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setConsentRecording(e.target.checked);
              pulisciErrore('consentRecording');
            }}
          />
          <Label for="consentRecording" check>
            {tg('consent.recording')}
          </Label>
          {errors.consentRecording && (
            <div id="consentRecordingError" className="text-danger small mt-1">
              {tg('consent.recordingRequired')}
            </div>
          )}
        </FormGroup>
      )}

      {/* ── Consent 2b: Multitrack per-participant recording (ADR-013) ── */}
      {multitrackRecordingEnabled && (
        <FormGroup check className="mb-3">
          <Input
            type="checkbox"
            id="consentMultitrack"
            aria-invalid={errors.consentMultitrack ? true : undefined}
            aria-required="true"
            aria-describedby={errors.consentMultitrack ? 'consentMultitrackError' : undefined}
            checked={consentMultitrack}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setConsentMultitrack(e.target.checked);
              pulisciErrore('consentMultitrack');
            }}
          />
          <Label for="consentMultitrack" check>
            {tg('consent.multitrack')}
          </Label>
          {errors.consentMultitrack && (
            <div id="consentMultitrackError" className="text-danger small mt-1">
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

      <Link href={percorso(`/events/${eventSlug}`)}>
        <Button color="secondary" outline tag="span">
          {tc('cancel')}
        </Button>
      </Link>
    </form>
  );
}
