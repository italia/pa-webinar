'use client';

/**
 * 5-step event creation wizard.
 *
 *   1. Base          — title, description, cover, dates, recurrence, tags,
 *                       waiting-room audio
 *   2. Permissions   — role×feature matrix + recording auto-start
 *   3. Invites       — organizers (display only), speakers (access grant),
 *                       guests (pre-registration)
 *   4. Content       — materials + Q&A presets + questionnaires
 *   5. Review        — GDPR/retention, load diagram, draft/publish
 *
 * The steps share a single form state (`WizardForm`) which, on submit,
 * is POSTed to /api/events. After create, the step 3 invites/organizers
 * are pushed to their respective side-APIs (event has an id at that point).
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter } from '@/i18n/navigation';
import {
  coerceMatrix,
  defaultMatrix,
  matrixFromToggles,
  togglesFromMatrix,
  type PermissionMatrix,
} from '@/lib/utils/permission-matrix';
import { toDatetimeLocalInTz, fromDatetimeLocalInTz } from '@/lib/utils/date-format';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';

import Step1Base, { type Step1Value } from './step-1-base';
import Step2Permissions, { type Step2Value } from './step-2-permissions';
import Step3Invites, { type Step3Value } from './step-3-invites';
import Step4Content, {
  type Step4Value,
  type QuestionnaireBlock,
  type AdhocQuestionDraft,
} from './step-4-content';
import Step5Review from './step-5-review';

export interface WizardTemplatePreset {
  id: string;
  name: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  autoStartRecording: boolean;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  maxParticipants: number;
  permissionMatrix?: PermissionMatrix | null;
  // Default wizard (semplificazione utenti meno esperti).
  defaultDurationMinutes?: number | null;
  aiTranscriptEnabled?: boolean;
  aiSummaryEnabled?: boolean;
  aiTranslationEnabled?: boolean;
  descriptionTemplate?: Record<string, string> | null;
  defaultRetentionDays?: number | null;
  defaultExpectedSpeakers?: number | null;
}

export interface WizardProps {
  template?: WizardTemplatePreset | null;
  siteTimezone: string;
  enabledLocales: string[];
  defaultLocale: string;
  defaultSenderRatioPct: number;
  defaultRetentionDays: number;
  jvbSizingConfig: JvbSizingConfig;
  availableTags: Array<{ slug: string; name: Record<string, string>; color: string | null }>;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  /** Site-wide default for the title-kicker parse. Used to decide whether
   *  to surface the per-event override in step 1 (hidden when already on). */
  siteDefaultParseTitleKicker: boolean;
  /** When `'edit'`, the wizard seeds state from `initialEvent`, PUTs to
   *  /api/events/:id on submit, and redirects to the admin detail page.
   *  When `'create'` (default), it POSTs to /api/events and falls into the
   *  classic post-create redirect. */
  mode?: 'create' | 'edit';
  /** Required when `mode === 'edit'`. Fully-loaded event + related
   *  entities so the wizard can diff on submit. */
  initialEvent?: InitialEventShape;
}

/**
 * Full edit-mode snapshot of the event and its related entities. This is
 * what the server page collects and hands to the wizard so it can seed
 * the form AND run diff-based fan-out on submit.
 */
export interface InitialEventShape {
  id: string;
  slug: string;
  moderatorToken: string;
  /** Raw event row (partial; only the fields the wizard needs). */
  event: {
    title: Record<string, string>;
    description: Record<string, string>;
    startsAt: string;
    endsAt: string;
    timezone: string;
    maxParticipants: number;
    coverImageUrl: string | null;
    imageUrl: string | null;
    waitingRoomAudioUrl: string | null;
    tagSlugs: string[];
    recurrenceRule: string | null;
    parseTitleKicker: boolean | null;
    expectedSenderRatioPct: number | null;
    permissionMatrix: PermissionMatrix | null;
    qaEnabled: boolean;
    chatEnabled: boolean;
    participantsCanUnmute: boolean;
    participantsCanStartVideo: boolean;
    participantsCanShareScreen: boolean;
    recordingEnabled: boolean;
    autoStartRecording: boolean;
    aiTranscriptEnabled?: boolean | null;
    aiSummaryEnabled?: boolean | null;
    aiTranslationEnabled?: boolean | null;
    aiDubbingEnabled?: boolean | null;
    multitrackRecordingEnabled?: boolean | null;
    aiTargetLocales?: string | null;
    expectedSpeakers?: number | null;
    dataRetentionDays: number;
    gdprTemplateId: string | null;
    privacyPolicyText: string | null;
    privacyPolicyUrl: string | null;
    moderatorName: string | null;
    moderatorEmail: string | null;
  };
  /** Each organizer with its DB id so we can DELETE on removal. */
  organizers: Array<{
    id: string;
    name: string;
    organization: string;
    logoUrl: string | null;
    websiteUrl: string | null;
  }>;
  /** EventModerator rows (both MODERATOR and SPEAKER roles). Used to
   *  populate both the moderators and speakers lists in step 3. */
  eventModerators: Array<{
    id: string;
    name: string;
    email: string | null;
    role: 'MODERATOR' | 'SPEAKER';
    personId: string | null;
  }>;
  invitations: Array<{
    id: string;
    name: string | null;
    email: string;
    role: 'GUEST' | 'SPEAKER';
    personId: string | null;
  }>;
  materials: Array<{
    id: string;
    title: string;
    url: string;
    description: string | null;
    type: 'file' | 'link';
    visibility: 'BEFORE' | 'DURING' | 'AFTER' | 'ALWAYS';
  }>;
  preEventQuestionnaire: QuestionnaireBlock | null;
  postEventQuestionnaire: QuestionnaireBlock | null;
}

export interface Step5ReviewFields {
  dataRetentionDays: number;
  gdprTemplateId: string | null;
  privacyPolicyText: string;
  privacyPolicyUrl: string | null;
  moderatorName: string;
  moderatorEmail: string;
}

export type WizardForm = Step1Value &
  Step2Value &
  Step3Value &
  Step4Value &
  Step5ReviewFields;

const STEP_KEYS = ['base', 'permissions', 'invites', 'content', 'review'] as const;
type StepKey = (typeof STEP_KEYS)[number];

export default function EventWizard(props: WizardProps) {
  const t = useTranslations('admin.wizard');
  const tc = useTranslations('common');
  const router = useRouter();

  const mode: 'create' | 'edit' = props.mode ?? 'create';
  const initialEvent = props.initialEvent;

  const defaultStart = new Date(Date.now() + 24 * 3600_000);
  // Durata predefinita dal template (semplificazione): l'utente meno esperto
  // imposta solo l'inizio e la fine è calcolata. Default 120 min se il
  // template non la specifica.
  const defaultDurationMin = props.template?.defaultDurationMinutes ?? 120;
  const defaultEnd = new Date(defaultStart.getTime() + defaultDurationMin * 60_000);

  // Initial form state seeded from template (when given) + sensible defaults,
  // or — in edit mode — from `initialEvent`.
  const initial: WizardForm = useMemo(() => {
    if (mode === 'edit' && initialEvent) {
      const ev = initialEvent.event;
      // Prefer the stored matrix; if absent (older events), project from
      // the legacy booleans so step 2 reflects the effective state.
      const matrix: PermissionMatrix =
        (ev.permissionMatrix && coerceMatrix(ev.permissionMatrix)) ??
        matrixFromToggles({
          qaEnabled: ev.qaEnabled,
          chatEnabled: ev.chatEnabled,
          participantsCanUnmute: ev.participantsCanUnmute,
          participantsCanStartVideo: ev.participantsCanStartVideo,
          participantsCanShareScreen: ev.participantsCanShareScreen,
        });

      return {
        // Step 1
        title: { it: ev.title.it ?? '', en: ev.title.en ?? '', ...ev.title },
        description: {
          it: ev.description.it ?? '',
          en: ev.description.en ?? '',
          ...ev.description,
        },
        startsAt: toDatetimeLocalInTz(new Date(ev.startsAt), ev.timezone),
        endsAt: toDatetimeLocalInTz(new Date(ev.endsAt), ev.timezone),
        timezone: ev.timezone,
        maxParticipants: ev.maxParticipants,
        coverImageUrl: ev.coverImageUrl,
        imageUrl: ev.imageUrl,
        waitingRoomAudioUrl: ev.waitingRoomAudioUrl,
        tagSlugs: ev.tagSlugs,
        recurrenceRule: ev.recurrenceRule,
        recurrencePreset: ev.recurrenceRule ? 'custom' : ('none' as const),
        recurrenceUntil: null,
        recurrenceCount: null,
        parseTitleKicker: ev.parseTitleKicker,
        expectedSenderRatioPct: ev.expectedSenderRatioPct,

        // Step 2
        permissionMatrix: matrix,
        recordingEnabled: ev.recordingEnabled,
        autoStartRecording: ev.autoStartRecording,
        aiTranscriptEnabled: ev.aiTranscriptEnabled ?? false,
        aiSummaryEnabled: ev.aiSummaryEnabled ?? false,
        aiTranslationEnabled: ev.aiTranslationEnabled ?? false,
        aiDubbingEnabled: ev.aiDubbingEnabled ?? false,
        multitrackRecordingEnabled: ev.multitrackRecordingEnabled ?? false,
        aiTargetLocales: ev.aiTargetLocales ?? null,
        expectedSpeakers: ev.expectedSpeakers ?? null,

        // Step 3 — seed lists from related entities.
        organizers: initialEvent.organizers.map((o) => ({
          name: o.name,
          organization: o.organization,
          logoUrl: o.logoUrl,
          websiteUrl: o.websiteUrl,
        })),
        moderators: initialEvent.eventModerators
          .filter((m) => m.role === 'MODERATOR')
          .map((m) => ({
            name: m.name,
            email: m.email ?? '',
            personId: m.personId,
          })),
        speakers: initialEvent.eventModerators
          .filter((m) => m.role === 'SPEAKER')
          .map((m) => ({
            name: m.name,
            email: m.email ?? '',
            personId: m.personId,
          })),
        invitations: initialEvent.invitations.map((i) => ({
          name: i.name,
          email: i.email,
          role: i.role,
          personId: i.personId,
        })),

        // Step 4
        materials: initialEvent.materials.map((m) => ({
          title: m.title,
          url: m.url,
          description: m.description,
          type: m.type,
          visibility: m.visibility,
        })),
        preEventQuestionnaire:
          initialEvent.preEventQuestionnaire ?? {
            templateIds: [],
            adhocQuestions: [],
          },
        postEventQuestionnaire:
          initialEvent.postEventQuestionnaire ?? {
            templateIds: [],
            adhocQuestions: [],
          },

        // Step 5
        dataRetentionDays: ev.dataRetentionDays,
        gdprTemplateId: ev.gdprTemplateId,
        privacyPolicyText: ev.privacyPolicyText ?? '',
        privacyPolicyUrl: ev.privacyPolicyUrl,
        moderatorName: ev.moderatorName ?? '',
        moderatorEmail: ev.moderatorEmail ?? '',
      } satisfies WizardForm;
    }

    const tpl = props.template;
    const matrix: PermissionMatrix = tpl?.permissionMatrix ?? defaultMatrix();
    return {
      // Step 1
      title: { it: '', en: '' },
      // Descrizione pre-compilata dal template (semplificazione), modificabile.
      description: {
        it: tpl?.descriptionTemplate?.it ?? '',
        en: tpl?.descriptionTemplate?.en ?? '',
      },
      startsAt: toDatetimeLocalInTz(defaultStart, props.siteTimezone),
      endsAt: toDatetimeLocalInTz(defaultEnd, props.siteTimezone),
      timezone: props.siteTimezone,
      maxParticipants: tpl?.maxParticipants ?? 150,
      coverImageUrl: null,
      imageUrl: null,
      waitingRoomAudioUrl: null,
      tagSlugs: [],
      recurrenceRule: null,
      recurrencePreset: 'none' as const,
      recurrenceUntil: null,
      recurrenceCount: null,
      parseTitleKicker: null,
      expectedSenderRatioPct: null,

      // Step 2
      permissionMatrix: matrix,
      recordingEnabled: tpl?.recordingEnabled ?? false,
      autoStartRecording: tpl?.autoStartRecording ?? false,
      // Default AI dal template (semplificazione): un template "registrato"
      // può pre-attivare trascrizione/sintesi. La trascrizione richiede la
      // registrazione, quindi la attiviamo solo se recordingEnabled.
      aiTranscriptEnabled: (tpl?.recordingEnabled ?? false) && (tpl?.aiTranscriptEnabled ?? false),
      aiSummaryEnabled:
        (tpl?.recordingEnabled ?? false) &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.aiSummaryEnabled ?? false),
      aiTranslationEnabled:
        (tpl?.recordingEnabled ?? false) &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.aiTranslationEnabled ?? false),
      aiDubbingEnabled: false,
      multitrackRecordingEnabled: false,
      aiTargetLocales: null,
      expectedSpeakers: tpl?.defaultExpectedSpeakers ?? null,

      // Step 3
      organizers: [],
      moderators: [],
      speakers: [],
      invitations: [],

      // Step 4
      materials: [],
      preEventQuestionnaire: { templateIds: [], adhocQuestions: [] },
      postEventQuestionnaire: { templateIds: [], adhocQuestions: [] },

      // Step 5 fields written here so review can surface them
      dataRetentionDays: tpl?.defaultRetentionDays ?? props.defaultRetentionDays,
      gdprTemplateId: null,
      privacyPolicyText: '',
      privacyPolicyUrl: null,
      moderatorName: '',
      moderatorEmail: '',
    } satisfies WizardForm;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.template, mode, initialEvent]);

  const [form, setForm] = useState<WizardForm>(initial);
  const [activeStep, setActiveStep] = useState<StepKey>('base');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const updateForm = useCallback((patch: Partial<WizardForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const stepIndex = STEP_KEYS.indexOf(activeStep);
  const goPrev = () => stepIndex > 0 && setActiveStep(STEP_KEYS[stepIndex - 1]!);
  const goNext = () => {
    const errs = validateStep(activeStep, form, props.defaultLocale);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setSubmitError(t('validationFailed'));
      return;
    }
    setFieldErrors({});
    setSubmitError(null);
    if (stepIndex < STEP_KEYS.length - 1) setActiveStep(STEP_KEYS[stepIndex + 1]!);
  };

  /**
   * POST to /api/events with the assembled payload, then fan out to
   * side-APIs (organizers, invitations, tags — tags come along in the
   * main payload, the wizard keeps both sets in sync).
   *
   * `overrideRedirect`, if provided, replaces the default post-create
   * redirect. A literal `"__questionnaires__"` is expanded to the
   * event's per-event questionnaire editor once the id is known.
   */
  const handleSubmit = useCallback(
    async (submitMode: 'draft' | 'publish', overrideRedirect?: string) => {
      // Validate every step before submitting (especially on publish).
      const aggregated: Record<string, string> = {};
      for (const key of STEP_KEYS) {
        Object.assign(aggregated, validateStep(key, form, props.defaultLocale));
      }
      if (submitMode === 'publish') {
        Object.assign(aggregated, validatePublish(form));
      }
      if (Object.keys(aggregated).length > 0) {
        setFieldErrors(aggregated);
        setSubmitError(t('validationFailed'));
        // Jump to the first failing step. Gli errori di validatePublish
        // (moderatorName/moderatorEmail) non sono coperti da validateStep e
        // i campi vivono nello step 'review': se solo quelli falliscono,
        // portiamo l'utente lì (altrimenti il messaggio resta senza campo
        // evidenziato visibile).
        const firstFailing = STEP_KEYS.find((k) =>
          Object.keys(validateStep(k, form, props.defaultLocale)).length > 0,
        );
        if (firstFailing) setActiveStep(firstFailing);
        else if (aggregated.moderatorName || aggregated.moderatorEmail) {
          setActiveStep('review');
        }
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      setFieldErrors({});
      try {
        // Derive boolean toggles from the matrix so legacy consumers stay
        // correct. The API also re-derives them server-side as a defensive
        // measure.
        const toggles = togglesFromMatrix(form.permissionMatrix);

        const startsAtUTC = fromDatetimeLocalInTz(form.startsAt, form.timezone).toISOString();
        const endsAtUTC = fromDatetimeLocalInTz(form.endsAt, form.timezone).toISOString();

        const payload: Record<string, unknown> = {
          title: form.title,
          description: form.description,
          startsAt: startsAtUTC,
          endsAt: endsAtUTC,
          timezone: form.timezone,
          maxParticipants: form.maxParticipants,
          coverImageUrl: form.coverImageUrl,
          imageUrl: form.imageUrl ?? undefined,
          waitingRoomAudioUrl: form.waitingRoomAudioUrl ?? undefined,
          tagSlugs: form.tagSlugs,
          recurrenceRule: form.recurrenceRule,
          parseTitleKicker: form.parseTitleKicker,
          expectedSenderRatioPct: form.expectedSenderRatioPct,

          // Permissions (matrix + derived booleans)
          permissionMatrix: form.permissionMatrix,
          qaEnabled: toggles.qaEnabled,
          chatEnabled: toggles.chatEnabled,
          participantsCanUnmute: toggles.participantsCanUnmute,
          participantsCanStartVideo: toggles.participantsCanStartVideo,
          participantsCanShareScreen: toggles.participantsCanShareScreen,
          recordingEnabled: form.recordingEnabled,
          autoStartRecording: form.recordingEnabled && form.autoStartRecording,

          // Postprod AI — subordinate al recording (server-side resta
          // un'invariante: senza recordingEnabled non c'è transcript).
          aiTranscriptEnabled: form.recordingEnabled && form.aiTranscriptEnabled,
          aiSummaryEnabled:
            form.recordingEnabled &&
            form.aiTranscriptEnabled &&
            form.aiSummaryEnabled,
          aiTranslationEnabled:
            form.recordingEnabled &&
            form.aiTranscriptEnabled &&
            form.aiTranslationEnabled,
          aiDubbingEnabled:
            form.recordingEnabled &&
            form.aiTranscriptEnabled &&
            form.aiTranslationEnabled &&
            form.aiDubbingEnabled,
          // Multi-traccia: subordinato a recording + transcript (è l'input
          // della trascrizione per-partecipante).
          multitrackRecordingEnabled:
            form.recordingEnabled &&
            form.aiTranscriptEnabled &&
            form.multitrackRecordingEnabled,
          aiTargetLocales: form.aiTargetLocales,
          expectedSpeakers: form.expectedSpeakers,

          // Review step
          dataRetentionDays: form.dataRetentionDays,
          gdprTemplateId: form.gdprTemplateId,
          privacyPolicyText: form.privacyPolicyText?.trim() || undefined,
          privacyPolicyUrl: form.privacyPolicyUrl ?? undefined,
          moderatorName: form.moderatorName?.trim() || undefined,
          moderatorEmail: form.moderatorEmail?.trim() || undefined,
        };

        // ── Edit mode: PUT the event, diff-based fan-out, then redirect
        //    back to the event detail page. Everything below the `return`
        //    is the "create" branch.
        if (mode === 'edit' && initialEvent) {
          const eventId = initialEvent.id;
          const moderatorToken = initialEvent.moderatorToken;

          const putRes = await fetch(
            `/api/events/${eventId}?token=${encodeURIComponent(moderatorToken)}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${moderatorToken}`,
              },
              body: JSON.stringify(payload),
            },
          );
          if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            if (err.details) {
              const next: Record<string, string> = {};
              for (const d of err.details) {
                const key = Array.isArray(d.path)
                  ? d.path.join('.')
                  : String(d.path ?? 'form');
                next[key] = d.message ?? 'Invalid';
              }
              setFieldErrors(next);
            }
            throw new Error(err.error ?? err.message ?? `HTTP ${putRes.status}`);
          }

          await fanoutEditDiff(eventId, moderatorToken, form, initialEvent, props.defaultLocale);

          router.push(
            `/admin/events/${eventId}?token=${encodeURIComponent(moderatorToken)}`,
          );
          return;
        }

        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          if (err.details) {
            const next: Record<string, string> = {};
            for (const d of err.details) {
              const key = Array.isArray(d.path) ? d.path.join('.') : String(d.path ?? 'form');
              next[key] = d.message ?? 'Invalid';
            }
            setFieldErrors(next);
          }
          throw new Error(err.error ?? err.message ?? `HTTP ${res.status}`);
        }
        const created = (await res.json()) as { id: string; slug: string };

        // Fan-out: side resources (organizers, invitations). Moderator
        // token is needed for the organizers POST — we can grab it from
        // the response.
        const moderatorToken = (created as { moderatorToken?: string }).moderatorToken;

        // 1) Organizers (primary-moderator auth)
        for (const org of form.organizers) {
          await fetch(`/api/events/${created.id}/organizers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({
              name: org.name,
              logoUrl: org.logoUrl,
              websiteUrl: org.websiteUrl,
            }),
          }).catch(() => {
            /* best-effort; admin can fix later */
          });
        }

        // 2) Invitations (admin-session auth)
        for (const inv of form.invitations) {
          await fetch(`/api/admin/events/${created.id}/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: inv.email,
              name: inv.name,
              role: inv.role,
              personId: inv.personId ?? undefined,
            }),
          }).catch(() => {
            /* best-effort */
          });
        }

        // 3) Moderators (EventModerator rows, MODERATOR role)
        for (const mod of form.moderators) {
          await fetch(`/api/events/${created.id}/moderators`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({
              name: mod.name,
              email: mod.email,
              role: 'MODERATOR',
            }),
          }).catch(() => {});
        }

        // 4) Speakers (additional EventModerator rows, SPEAKER role)
        for (const sp of form.speakers) {
          await fetch(`/api/events/${created.id}/moderators`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({
              name: sp.name,
              email: sp.email,
              role: 'SPEAKER',
            }),
          }).catch(() => {});
        }

        // 4) Materials
        for (const m of form.materials) {
          await fetch(`/api/admin/events/${created.id}/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(m),
          }).catch(() => {});
        }

        // 5) Questionnaires (pre/post)
        await submitQuestionnaire(
          created.id,
          'PRE_REGISTRATION',
          form.preEventQuestionnaire,
          props.defaultLocale,
        );
        await submitQuestionnaire(
          created.id,
          'POST_EVENT',
          form.postEventQuestionnaire,
          props.defaultLocale,
        );

        // 6) Promote from DRAFT → PUBLISHED if requested. The create
        //    endpoint currently doesn't accept status; use PUT on the
        //    detail route (the route only exports PUT, not PATCH).
        if (submitMode === 'publish') {
          await fetch(`/api/events/${created.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({ status: 'PUBLISHED' }),
          }).catch(() => {});
        }

        let destination = `/admin/events/${created.id}/edit?created=1`;
        if (overrideRedirect === '__questionnaires__') {
          destination = `/admin/events/${created.id}/questionnaires`;
        } else if (overrideRedirect) {
          destination = overrideRedirect;
        }
        router.push(destination);
      } catch (e) {
        setSubmitError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setSubmitting(false);
      }
    },
    [form, router, props.defaultLocale, t, mode, initialEvent],
  );

  const saveDraftAndNavigate = useCallback(
    async (destination: string) => {
      await handleSubmit('draft', destination);
    },
    [handleSubmit],
  );

  return (
    <div>
      <StepNav
        steps={STEP_KEYS.map((k) => ({ key: k, label: t(`steps.${k}`) }))}
        activeStep={activeStep}
        onJump={(k) => setActiveStep(k)}
      />

      {submitError && (
        <div className="alert alert-danger mt-3" role="alert">
          {submitError}
        </div>
      )}

      <div className="mt-4">
        {activeStep === 'base' && (
          <Step1Base
            value={form}
            onChange={updateForm}
            enabledLocales={props.enabledLocales}
            defaultLocale={props.defaultLocale}
            availableTags={props.availableTags}
            fieldErrors={fieldErrors}
            siteDefaultParseTitleKicker={props.siteDefaultParseTitleKicker}
            defaultSenderRatioPct={props.defaultSenderRatioPct}
          />
        )}
        {activeStep === 'permissions' && (
          <Step2Permissions
            value={form}
            onChange={updateForm}
          />
        )}
        {activeStep === 'invites' && (
          <Step3Invites
            value={form}
            onChange={updateForm}
          />
        )}
        {activeStep === 'content' && (
          <Step4Content
            value={form}
            onChange={updateForm}
            onSaveDraftAndNavigate={saveDraftAndNavigate}
            submitting={submitting}
          />
        )}
        {activeStep === 'review' && (
          <Step5Review
            form={form}
            onChange={updateForm}
            jvbSizingConfig={props.jvbSizingConfig}
            defaultSenderRatioPct={props.defaultSenderRatioPct}
            gdprTemplates={props.gdprTemplates}
            fieldErrors={fieldErrors}
          />
        )}
      </div>

      <div className="d-flex justify-content-between mt-4 pt-3" style={{ borderTop: '1px solid #e8e8e8' }}>
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={goPrev}
          disabled={stepIndex === 0 || submitting}
        >
          ← {tc('back')}
        </button>

        {activeStep !== 'review' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={goNext}
            disabled={submitting}
          >
            {tc('next')} →
          </button>
        ) : mode === 'edit' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit('draft')}
            disabled={submitting}
          >
            {submitting ? '...' : t('updateEvent')}
          </button>
        ) : (
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => handleSubmit('draft')}
              disabled={submitting}
            >
              {t('saveDraft')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSubmit('publish')}
              disabled={submitting}
            >
              {submitting ? '...' : t('publish')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step navigation bar ─────────────────────────────────────────────────────
//
// Horizontal stepper with numbered circles and connecting lines. Each step
// is a clickable button — admins can jump back to edit an earlier step
// without losing later work (all steps share the same form state).

function StepNav({
  steps,
  activeStep,
  onJump,
}: {
  steps: Array<{ key: StepKey; label: string }>;
  activeStep: StepKey;
  onJump: (k: StepKey) => void;
}) {
  const activeIdx = steps.findIndex((s) => s.key === activeStep);
  return (
    <nav aria-label="Wizard steps" className="mb-3">
      <ol className="d-flex align-items-center justify-content-between list-unstyled mb-0 flex-wrap gap-2">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          const bg = isActive ? '#0066CC' : isDone ? '#5C9EFF' : '#DEE5EC';
          const color = isActive || isDone ? '#fff' : 'var(--app-text)';
          return (
            <li key={s.key} className="flex-grow-1">
              <button
                type="button"
                onClick={() => onJump(s.key)}
                className="d-flex align-items-center gap-2 w-100 border-0 bg-transparent p-2 rounded"
                style={{
                  cursor: 'pointer',
                  borderBottom: isActive ? '3px solid #0066CC' : '3px solid transparent',
                }}
              >
                <span
                  className="d-inline-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    backgroundColor: bg,
                    color,
                    fontSize: '0.9rem',
                  }}
                  aria-hidden="true"
                >
                  {isDone ? '✓' : i + 1}
                </span>
                <span
                  className={isActive ? 'fw-bold' : ''}
                  style={{
                    color: isActive ? '#0066CC' : 'var(--app-text)',
                    fontSize: '0.9rem',
                    textAlign: 'left',
                  }}
                >
                  {s.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Step validation ─────────────────────────────────────────────────────────
// Client-side field checks that must pass before advancing. Keyed by
// dot-path so Step components can surface per-field errors inline.

function validateStep(
  step: StepKey,
  form: WizardForm,
  defaultLocale: string,
): Record<string, string> {
  const errs: Record<string, string> = {};
  if (step === 'base') {
    const titleDef = (form.title[defaultLocale] ?? '').trim();
    if (titleDef.length < 3) {
      errs[`title.${defaultLocale}`] = 'required';
    }
    try {
      const start = new Date(form.startsAt);
      const end = new Date(form.endsAt);
      if (Number.isNaN(start.getTime())) errs['startsAt'] = 'invalid';
      if (Number.isNaN(end.getTime())) errs['endsAt'] = 'invalid';
      if (!errs['startsAt'] && !errs['endsAt'] && end <= start) {
        errs['endsAt'] = 'mustBeAfterStart';
      }
    } catch {
      errs['startsAt'] = 'invalid';
    }
    if (
      !Number.isFinite(form.maxParticipants) ||
      form.maxParticipants < 2 ||
      form.maxParticipants > 500
    ) {
      errs['maxParticipants'] = 'outOfRange';
    }
  }
  return errs;
}

function validatePublish(form: WizardForm): Record<string, string> {
  const errs: Record<string, string> = {};
  const email = (form.moderatorEmail ?? '').trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errs['moderatorEmail'] = 'required';
  }
  const name = (form.moderatorName ?? '').trim();
  if (name.length < 2) {
    errs['moderatorName'] = 'required';
  }
  return errs;
}

// ── Questionnaire fan-out helpers ──────────────────────────────────────────

type Placement = 'PRE_REGISTRATION' | 'POST_EVENT';

const PLACEMENT_TITLES: Record<Placement, { it: string; en: string }> = {
  PRE_REGISTRATION: { it: 'Pre-evento', en: 'Pre-event' },
  POST_EVENT: { it: 'Post-evento', en: 'Post-event' },
};

function mapAdhocToApi(
  draft: AdhocQuestionDraft,
  index: number,
  defaultLocale: string,
) {
  const prompt: Record<string, string> = { [defaultLocale]: draft.prompt.trim() };
  const base: Record<string, unknown> = {
    prompt,
    type: draft.type,
    required: draft.required,
    sortOrder: index,
  };
  if (draft.type === 'SINGLE_CHOICE' || draft.type === 'MULTI_CHOICE') {
    base.options = draft.options
      .map((o) => o.trim())
      .filter((o) => o.length > 0)
      .map((o) => ({ [defaultLocale]: o }));
  }
  if (draft.type === 'LIKERT') {
    if (draft.scaleMin != null) base.scaleMin = draft.scaleMin;
    if (draft.scaleMax != null) base.scaleMax = draft.scaleMax;
  }
  return base;
}

async function submitQuestionnaire(
  eventId: string,
  placement: Placement,
  block: QuestionnaireBlock,
  defaultLocale: string,
): Promise<void> {
  if (block.templateIds.length === 0 && block.adhocQuestions.length === 0) {
    return;
  }
  const body = {
    placement,
    title: PLACEMENT_TITLES[placement],
    description: {},
    required: false,
    allowEdit: false,
    templateIds: block.templateIds,
    adhocItems: block.adhocQuestions.map((q, i) =>
      mapAdhocToApi(q, i, defaultLocale),
    ),
  };
  await fetch(
    `/api/admin/events/${eventId}/questionnaires/${placement}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  ).catch(() => {
    /* best-effort; admin can fix from the questionnaires page */
  });
}

// ── Edit-mode fan-out: diff against the initial snapshot ────────────────────
//
// For each related collection (organizers / event moderators / invitations /
// materials) we:
//   – POST every row in `form` that is NOT in the initial snapshot (by a
//     stable identity key), and
//   – DELETE every initial row that is NOT in `form` by the same key.
//
// Identity keys:
//   – organizers:        `${name}|${organization}`
//   – moderators:        `${role}|${email}`
//   – invitations:       `${email}` (invitations are event-scoped unique by email)
//   – materials:         `${title}|${url}`
//
// Rows that exist on both sides are left untouched — the admin who only
// wanted to rename/reorder would need a dedicated PATCH-each row flow,
// which is out of scope for this refactor. Renaming effectively
// "replaces" the row (delete + re-add) which is acceptable here.
//
// Questionnaires are handled differently: the upsert endpoint is PUT and
// idempotently replaces templates + adhoc items, so we just call it.

async function fanoutEditDiff(
  eventId: string,
  moderatorToken: string,
  form: WizardForm,
  initial: InitialEventShape,
  defaultLocale: string,
): Promise<void> {
  // Organizers
  const orgKey = (o: { name: string; organization: string }) =>
    `${o.name}|${o.organization}`;
  const initialOrgByKey = new Map(
    initial.organizers.map((o) => [orgKey(o), o]),
  );
  const currentOrgKeys = new Set(form.organizers.map(orgKey));
  for (const o of form.organizers) {
    if (initialOrgByKey.has(orgKey(o))) continue;
    await fetch(`/api/events/${eventId}/organizers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${moderatorToken}`,
      },
      body: JSON.stringify({
        name: o.name,
        logoUrl: o.logoUrl,
        websiteUrl: o.websiteUrl,
      }),
    }).catch(() => {});
  }
  for (const o of initial.organizers) {
    if (currentOrgKeys.has(orgKey(o))) continue;
    await fetch(`/api/events/${eventId}/organizers/${o.id}`, {
      method: 'DELETE',
      headers: { 'X-Moderator-Token': moderatorToken },
    }).catch(() => {});
  }

  // EventModerators (MODERATOR + SPEAKER roles share one table)
  const modKey = (
    m: { email: string | null; role: 'MODERATOR' | 'SPEAKER' },
  ) => `${m.role}|${(m.email ?? '').toLowerCase()}`;
  const initialModByKey = new Map(
    initial.eventModerators.map((m) => [modKey(m), m]),
  );
  const currentMods: Array<{ email: string; role: 'MODERATOR' | 'SPEAKER'; name: string }> = [
    ...form.moderators.map((m) => ({ email: m.email, role: 'MODERATOR' as const, name: m.name })),
    ...form.speakers.map((s) => ({ email: s.email, role: 'SPEAKER' as const, name: s.name })),
  ];
  const currentModKeys = new Set(currentMods.map(modKey));
  for (const m of currentMods) {
    if (initialModByKey.has(modKey(m))) continue;
    await fetch(`/api/events/${eventId}/moderators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${moderatorToken}`,
      },
      body: JSON.stringify({ name: m.name, email: m.email, role: m.role }),
    }).catch(() => {});
  }
  for (const m of initial.eventModerators) {
    if (currentModKeys.has(modKey(m))) continue;
    await fetch(`/api/events/${eventId}/moderators/${m.id}`, {
      method: 'DELETE',
      headers: { 'X-Moderator-Token': moderatorToken },
    }).catch(() => {});
  }

  // Invitations (admin-session auth, no moderator token)
  const invKey = (i: { email: string }) => i.email.toLowerCase();
  const initialInvByKey = new Map(initial.invitations.map((i) => [invKey(i), i]));
  const currentInvKeys = new Set(form.invitations.map(invKey));
  for (const i of form.invitations) {
    if (initialInvByKey.has(invKey(i))) continue;
    await fetch(`/api/admin/events/${eventId}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: i.email,
        name: i.name ?? undefined,
        role: i.role,
        personId: i.personId ?? undefined,
      }),
    }).catch(() => {});
  }
  for (const i of initial.invitations) {
    if (currentInvKeys.has(invKey(i))) continue;
    await fetch(`/api/admin/events/${eventId}/invitations/${i.id}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  // Materials
  const matKey = (m: { title: string; url: string }) => `${m.title}|${m.url}`;
  const initialMatByKey = new Map(initial.materials.map((m) => [matKey(m), m]));
  const currentMatKeys = new Set(form.materials.map(matKey));
  for (const m of form.materials) {
    if (initialMatByKey.has(matKey(m))) continue;
    await fetch(`/api/admin/events/${eventId}/materials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(m),
    }).catch(() => {});
  }
  for (const m of initial.materials) {
    if (currentMatKeys.has(matKey(m))) continue;
    await fetch(`/api/admin/events/${eventId}/materials/${m.id}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  // Questionnaires — PUT is idempotent (replaces templates + adhoc items).
  // The server rejects with 409 if responses already exist; that failure is
  // silently swallowed here, matching create-mode behaviour. TODO: surface
  // this back to the admin (e.g. a toast) instead of just ignoring it.
  await submitQuestionnaire(
    eventId,
    'PRE_REGISTRATION',
    form.preEventQuestionnaire,
    defaultLocale,
  );
  await submitQuestionnaire(
    eventId,
    'POST_EVENT',
    form.postEventQuestionnaire,
    defaultLocale,
  );
}
