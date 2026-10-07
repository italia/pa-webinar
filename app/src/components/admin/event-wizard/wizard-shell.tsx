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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { useRouter, percorso } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { eventAdminPath } from '@/lib/events/admin-links';
import { MAX_RETENTION_DAYS } from '@/lib/validation/retention';
import {
  coerceMatrix,
  defaultMatrix,
  matrixFromToggles,
  togglesFromMatrix,
  type PermissionMatrix,
} from '@/lib/utils/permission-matrix';
import { toDatetimeLocalInTz, fromDatetimeLocalInTz } from '@/lib/utils/date-format';
import { parseLocaleList, SOURCE_LANGUAGE_FALLBACK } from '@/lib/ai/target-locales';
import type { JvbSizingConfig } from '@/lib/jvb-sizing';
import type { VideoQualityPreset } from '@/lib/jitsi/config';

import { RubricaAccessContext } from '../rubrica-picker';

import { fanoutEditDiff, materialPayload, newFanoutReport, submitQuestionnaire } from './edit-fanout';
import { rememberCreation, type UnsavedResource } from './created-event';
import Step1Base, { type Step1Value } from './step-1-base';
import Step2Permissions, { type Step2Value } from './step-2-permissions';
import Step3Invites, { type Step3Value } from './step-3-invites';
import Step4Content, {
  type Step4Value,
  type QuestionnaireBlock,
} from './step-4-content';
import Step5Review from './step-5-review';
import {
  STEP_KEYS,
  mapServerIssues,
  validatePublish,
  validateStep,
  type StepKey,
} from './validation';

export interface WizardTemplatePreset {
  id: string;
  name: string;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled: boolean;
  autoStartRecording: boolean;
  agendaEnabled?: boolean;
  wordCloudEnabled?: boolean;
  whiteboardEnabled?: boolean;
  waitingRoomEngine?: 'GARDEN' | 'GAME' | 'CLASSIC' | null;
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
  aiDubbingEnabled?: boolean;
  multitrackRecordingEnabled?: boolean;
  retainParticipantTracks?: boolean;
  aiTargetLocales?: string | null;
  descriptionTemplate?: Record<string, string> | null;
  defaultRetentionDays?: number | null;
  defaultExpectedSpeakers?: number | null;
  /** La pagina dopo l'evento e' pubblica (false per una riunione di lavoro). */
  postEventPublic?: boolean;
}

export interface WizardProps {
  template?: WizardTemplatePreset | null;
  siteTimezone: string;
  enabledLocales: string[];
  defaultLocale: string;
  defaultSenderRatioPct: number;
  defaultRetentionDays: number;
  /** Mostrare la ricerca in rubrica negli inviti: solo all'amministrazione. */
  canUseRubrica?: boolean;
  /** In modifica, il token con cui si e' entrati se non c'e' una sessione dello
   *  staff: solo allora il ritorno alla pagina dell'evento lo porta con se'. */
  viaToken?: string | null;
  jvbSizingConfig: JvbSizingConfig;
  availableTags: Array<{ slug: string; name: Record<string, string>; color: string | null }>;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  /** Site-wide default for the title-kicker parse. Used to decide whether
   *  to surface the per-event override in step 1 (hidden when already on). */
  siteDefaultParseTitleKicker: boolean;
  /** Site-wide default video/audio quality, shown as the resolved value
   *  for the per-event override in step 1. */
  siteDefaultVideoQuality: VideoQualityPreset;
  /** Se l'installazione ha il servizio della lavagna di Jitsi
   *  (`resolveWhiteboardInfraReady`, letto dalla pagina server). Senza, la
   *  sala non mostra la lavagna e il passo 2 non la offre. */
  whiteboardInfraReady: boolean;
  /** Le lingue di traduzione predefinite dell'istanza (SiteSetting). */
  defaultTargetLocales?: string | null;
  /** La post-produzione AI e' accesa sull'installazione: spenta, il passo 2
   *  non ne propone le funzioni. */
  aiPipelineEnabled?: boolean;
  /** In modifica: il passo da cui partire (i link «Modifica» della pagina
   *  dell'evento portano dritti a quello che serve). */
  initialStep?: StepKey;
  /** Il moderatore principale di partenza di un evento nuovo: chi lo crea,
   *  quando entra con un account nominale. */
  defaultModerator?: { name: string; email: string } | null;
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
    waitingRoomEngine: 'GARDEN' | 'GAME' | 'CLASSIC' | null;
    videoQuality: VideoQualityPreset | null;
    expectedSenderRatioPct: number | null;
    permissionMatrix: PermissionMatrix | null;
    /** Lo stato dell'evento: in bozza i link personali non partono ancora. */
    status: string;
    qaEnabled: boolean;
    chatEnabled: boolean;
    participantsCanUnmute: boolean;
    participantsCanStartVideo: boolean;
    participantsCanShareScreen: boolean;
    recordingEnabled: boolean;
    agendaEnabled?: boolean | null;
    wordCloudEnabled?: boolean | null;
    whiteboardEnabled?: boolean | null;
    autoStartRecording: boolean;
    aiTranscriptEnabled?: boolean | null;
    aiSummaryEnabled?: boolean | null;
    aiTranslationEnabled?: boolean | null;
    aiDubbingEnabled?: boolean | null;
    multitrackRecordingEnabled?: boolean | null;
    retainParticipantTracks?: boolean | null;
    aiTargetLocales?: string | null;
    expectedSpeakers?: number | null;
    dataRetentionDays: number;
    postEventPublic: boolean;
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
    fileName?: string | null;
    fileSize?: number | null;
    mimeType?: string | null;
    blobPath?: string | null;
  }>;
  preEventQuestionnaire: QuestionnaireBlock | null;
  postEventQuestionnaire: QuestionnaireBlock | null;
}

export interface Step5ReviewFields {
  dataRetentionDays: number;
  /** Event.postEventPublic: la pagina dell'evento concluso resta visibile. */
  postEventPublic: boolean;
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

export default function EventWizard(props: WizardProps) {
  const t = useTranslations('admin.wizard');
  const tc = useTranslations('common');
  const tDetail = useTranslations('admin.eventDetail');
  const router = useRouter();
  const toast = useToast();

  const mode: 'create' | 'edit' = props.mode ?? 'create';
  const viaToken = props.viaToken ?? null;
  const initialEvent = props.initialEvent;
  // Un evento gia' salvato con una conservazione piu' lunga del massimo (le
  // pubblicazioni in libreria) si puo' modificare senza toccarla: in quel caso
  // il valore non si rimanda (vedi il payload).
  const initialRetention = initialEvent?.event.dataRetentionDays ?? null;
  const retentionMax = Math.max(MAX_RETENTION_DAYS, initialRetention ?? 0);
  /**
   * Lo scatto delle risorse collegate, aggiornato a ogni salvataggio riuscito.
   *
   * La prop e' la fotografia presa all'apertura della pagina e non viene mai
   * riletta. Da quando un fallimento parziale lascia l'operatore sulla pagina
   * a riprovare, servono due giri sulla stessa istanza: senza conservare qui
   * cio' che e' andato a buon fine, il secondo giro ricreerebbe le righe del
   * primo. Copia profonda, perche' il fan-out la modifica.
   */
  const snapshotRef = useRef<InitialEventShape | null>(null);
  if (initialEvent && snapshotRef.current === null) {
    snapshotRef.current = structuredClone(initialEvent);
  }


  // Initial form state seeded from template (when given) + sensible defaults,
  // or — in edit mode — from `initialEvent`.
  const initial: WizardForm = useMemo(() => {
    // Un evento nuovo parte da domani alle 10 nell'ora dell'istanza: un orario
    // da riunione, non il minuto in cui si apre il modulo. "Domani" e' il
    // giorno di calendario dopo oggi in quel fuso, non adesso piu' 24 ore
    // (che al cambio dell'ora legale salta un giorno o resta su oggi).
    const [y, m, d] = toDatetimeLocalInTz(new Date(), props.siteTimezone)
      .slice(0, 10)
      .split('-')
      .map(Number);
    const domani = new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
    const defaultStart = fromDatetimeLocalInTz(`${domani}T10:00`, props.siteTimezone);
    // Durata predefinita dal template (semplificazione): l'utente meno esperto
    // imposta solo l'inizio e la fine è calcolata. Un template senza durata
    // tiene le due ore di sempre; senza template valgono i valori del
    // «Webinar pubblico»: un'ora, fino a 300 persone.
    const defaultDurationMin = props.template
      ? (props.template.defaultDurationMinutes ?? 120)
      : 60;
    const defaultEnd = new Date(defaultStart.getTime() + defaultDurationMin * 60_000);
    // Traduzione accesa senza lingue (un modello o un evento che ereditava le
    // lingue dell'istanza): si parte da quelle dell'istanza, gia' spuntate.
    const lingueDiPartenza = (traduce: boolean | null | undefined, lingue: string | null | undefined) =>
      lingue ??
      (traduce
        ? parseLocaleList(props.defaultTargetLocales)
            .filter((c) => c !== SOURCE_LANGUAGE_FALLBACK)
            .join(',') || null
        : null);
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
        waitingRoomEngine: ev.waitingRoomEngine,
        videoQuality: ev.videoQuality,
        expectedSenderRatioPct: ev.expectedSenderRatioPct,

        // Step 2
        permissionMatrix: matrix,
        recordingEnabled: ev.recordingEnabled,
        agendaEnabled: ev.agendaEnabled ?? false,
        wordCloudEnabled: ev.wordCloudEnabled ?? false,
        whiteboardEnabled: ev.whiteboardEnabled ?? false,
        autoStartRecording: ev.autoStartRecording,
        aiTranscriptEnabled: ev.aiTranscriptEnabled ?? false,
        aiSummaryEnabled: ev.aiSummaryEnabled ?? false,
        aiTranslationEnabled: ev.aiTranslationEnabled ?? false,
        aiDubbingEnabled: ev.aiDubbingEnabled ?? false,
        multitrackRecordingEnabled: ev.multitrackRecordingEnabled ?? false,
        retainParticipantTracks: ev.retainParticipantTracks ?? false,
        aiTargetLocales: lingueDiPartenza(ev.aiTranslationEnabled, ev.aiTargetLocales),
        expectedSpeakers: ev.expectedSpeakers ?? null,

        // Step 3 — seed lists from related entities.
        organizers: initialEvent.organizers.map((o) => ({
          name: o.name,
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
        postEventPublic: ev.postEventPublic,
        gdprTemplateId: ev.gdprTemplateId,
        privacyPolicyText: ev.privacyPolicyText ?? '',
        privacyPolicyUrl: ev.privacyPolicyUrl,
        moderatorName: ev.moderatorName ?? '',
        moderatorEmail: ev.moderatorEmail ?? '',
      } satisfies WizardForm;
    }

    const tpl = props.template;
    // Seed the permission matrix from the template. Prefer the template's
    // stored matrix; if it has none (the common case — templates only persist
    // the legacy boolean toggles), PROJECT those booleans into the matrix so
    // the template's permission choices actually reach step 2. Falling back to
    // defaultMatrix() here (the old behaviour) silently dropped every
    // template's permissions — "come se non si potessero scegliere".
    const matrix: PermissionMatrix = tpl
      ? ((tpl.permissionMatrix && coerceMatrix(tpl.permissionMatrix)) ??
          matrixFromToggles({
            qaEnabled: tpl.qaEnabled,
            chatEnabled: tpl.chatEnabled,
            participantsCanUnmute: tpl.participantsCanUnmute,
            participantsCanStartVideo: tpl.participantsCanStartVideo,
            participantsCanShareScreen: tpl.participantsCanShareScreen,
          }))
      : defaultMatrix();
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
      maxParticipants: tpl?.maxParticipants ?? 300,
      coverImageUrl: null,
      imageUrl: null,
      waitingRoomAudioUrl: null,
      tagSlugs: [],
      recurrenceRule: null,
      recurrencePreset: 'none' as const,
      recurrenceUntil: null,
      recurrenceCount: null,
      parseTitleKicker: null,
      // Pre-popola dal template (null = default sito); prima era hardcoded a
      // null → il motore sala d'attesa del template non arrivava al wizard.
      waitingRoomEngine: tpl?.waitingRoomEngine ?? null,
      videoQuality: null,
      expectedSenderRatioPct: null,

      // Step 2
      permissionMatrix: matrix,
      recordingEnabled: tpl?.recordingEnabled ?? false,
      agendaEnabled: tpl?.agendaEnabled ?? false,
      wordCloudEnabled: tpl?.wordCloudEnabled ?? false,
      whiteboardEnabled: tpl?.whiteboardEnabled ?? false,
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
      // Presi dal template, non piu' cablati a false: e' qui che la
      // configurazione di una serie si perdeva. La registrazione per
      // partecipante resta subordinata alla registrazione video, come per la
      // trascrizione qui sopra: catturare le tracce di chi parla senza che
      // l'evento sia registrato non ha senso e sarebbe una raccolta di dati
      // personali senza scopo.
      aiDubbingEnabled:
        (tpl?.recordingEnabled ?? false) &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.aiDubbingEnabled ?? false),
      multitrackRecordingEnabled:
        (tpl?.recordingEnabled ?? false) && (tpl?.multitrackRecordingEnabled ?? false),
      retainParticipantTracks:
        (tpl?.recordingEnabled ?? false) &&
        (tpl?.multitrackRecordingEnabled ?? false) &&
        (tpl?.retainParticipantTracks ?? false),
      aiTargetLocales: lingueDiPartenza(tpl?.aiTranslationEnabled, tpl?.aiTargetLocales),
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
      // Un template salvato prima del limite attuale puo' avere un valore piu'
      // alto: si riporta entro il massimo, altrimenti l'evento non si salva.
      dataRetentionDays: Math.min(
        tpl?.defaultRetentionDays ?? props.defaultRetentionDays,
        MAX_RETENTION_DAYS,
      ),
      postEventPublic: tpl?.postEventPublic ?? true,
      // Il modello marcato come predefinito esiste per essere pre-scelto sui
      // nuovi eventi: senza questo la colonna resterebbe vuota su ogni evento
      // creato da qui, e quella marcatura non avrebbe alcun effetto.
      gdprTemplateId: props.gdprTemplates.find((g) => g.isDefault)?.id ?? null,
      privacyPolicyText: '',
      privacyPolicyUrl: null,
      moderatorName: props.defaultModerator?.name ?? '',
      moderatorEmail: props.defaultModerator?.email ?? '',
    } satisfies WizardForm;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.template, mode, initialEvent]);

  const [form, setForm] = useState<WizardForm>(initial);
  // Il passo di partenza vale solo in modifica: in creazione si comincia
  // dall'inizio.
  // Quale pulsante ha avviato il salvataggio: solo lui dice «Salvataggio…».
  const [azione, setAzione] = useState<'draft' | 'publish' | null>(null);
  const [activeStep, setActiveStep] = useState<StepKey>(
    (mode === 'edit' ? props.initialStep : undefined) ?? 'base',
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Gli errori trovati nel browser: spariscono appena il campo torna valido.
  // Quelli del server restano fino al prossimo invio, perche' qui non si sa
  // ricontrollarli.
  const chiaviClientRef = useRef<Set<string>>(new Set());
  // Dopo un invio rifiutato il fuoco va al primo campo da correggere.
  const fuocoRichiestoRef = useRef(false);

  // On step change move focus to the step region and scroll it into view so
  // keyboard/screen-reader users aren't left on the footer button (and a
  // validation jump to a failing step is perceivable). Skip the first render.
  const contentRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const el = contentRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [activeStep]);

  // L'avviso sta sopra il passo, mentre «Avanti» e «Pubblica» stanno in fondo:
  // un errore mostrato senza portarlo in vista sembra un pulsante che non fa
  // niente. Il contatore fa scorrere anche quando il testo non cambia (stesso
  // errore al secondo tentativo). Dichiarato dopo l'effetto del cambio passo,
  // cosi' quando cambiano insieme vince l'avviso. Quando invece c'e' un campo
  // da correggere vince il campo (vedi sotto): il suo messaggio e il
  // riepilogo accanto ai pulsanti dicono che cosa fare.
  const alertRef = useRef<HTMLDivElement>(null);
  const [errorSeq, setErrorSeq] = useState(0);
  const showError = useCallback((message: string) => {
    setSubmitError(message);
    setErrorSeq((n) => n + 1);
  }, []);
  useEffect(() => {
    if (errorSeq === 0 || fuocoRichiestoRef.current) return;
    alertRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [errorSeq]);

  // Un errore trovato nel browser sparisce appena il campo torna valido; quando
  // non ne resta nessuno sparisce anche l'avviso.
  useEffect(() => {
    const chiavi = chiaviClientRef.current;
    if (chiavi.size === 0) return;
    const ancora: Record<string, string> = { ...validatePublish(form) };
    for (const k of STEP_KEYS) Object.assign(ancora, validateStep(k, form, props.defaultLocale, retentionMax));
    const risolte = [...chiavi].filter((k) => !(k in ancora));
    if (risolte.length === 0) return;
    for (const k of risolte) chiavi.delete(k);
    const next = { ...fieldErrors };
    for (const k of risolte) delete next[k];
    setFieldErrors(next);
    if (Object.keys(next).length === 0) setSubmitError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // I campi non validi del passo, come li segnano i passi (classe
  // `is-invalid`): li si marca come tali per le tecnologie assistive,
  // collegati al loro messaggio, e un riepilogo accanto ai pulsanti ci porta.
  // Fatto qui una volta per i cinque passi, invece che campo per campo. La
  // classe la cambia anche altro stato dei passi (la lingua mostrata, l'errore
  // proprio di un campo): un osservatore delle classi tiene allineati
  // attributi e riepilogo.
  const [riepilogo, setRiepilogo] = useState<string[]>([]);
  const campiNonValidiRef = useRef<HTMLElement[]>([]);
  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const allinea = () => {
      root.querySelectorAll<HTMLElement>('[data-wizard-invalid]').forEach((el) => {
        if (el.classList.contains('is-invalid')) return;
        el.removeAttribute('aria-invalid');
        const prima = el.getAttribute('data-wizard-describedby');
        if (prima) el.setAttribute('aria-describedby', prima);
        else el.removeAttribute('aria-describedby');
        el.removeAttribute('data-wizard-invalid');
        el.removeAttribute('data-wizard-describedby');
      });
      const campi = [
        ...root.querySelectorAll<HTMLElement>('input.is-invalid, textarea.is-invalid, select.is-invalid'),
      ];
      const etichette: string[] = [];
      campi.forEach((el, i) => {
        if (!el.hasAttribute('data-wizard-invalid')) {
          el.setAttribute('data-wizard-invalid', '');
          el.setAttribute('data-wizard-describedby', el.getAttribute('aria-describedby') ?? '');
        }
        if (el.getAttribute('aria-invalid') !== 'true') el.setAttribute('aria-invalid', 'true');
        const messaggio = el.parentElement?.querySelector<HTMLElement>('.invalid-feedback');
        if (messaggio) {
          if (!messaggio.id) messaggio.id = `wizard-errore-${activeStep}-${i}`;
          const voluto = [el.getAttribute('data-wizard-describedby'), messaggio.id].filter(Boolean).join(' ');
          if (el.getAttribute('aria-describedby') !== voluto) el.setAttribute('aria-describedby', voluto);
        }
        const etichetta =
          el.getAttribute('data-wizard-label') ||
          (el.id && root.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()) ||
          el.getAttribute('aria-label') ||
          el.getAttribute('placeholder') ||
          '';
        etichette.push(etichetta.replace(/\s*\*$/, ''));
      });
      campiNonValidiRef.current = campi;
      setRiepilogo((prima) =>
        prima.length === etichette.length && prima.every((e, i) => e === etichette[i]) ? prima : etichette,
      );
      return campi;
    };

    const campi = allinea();
    // Dopo un invio rifiutato: il primo campo da correggere prende il fuoco e
    // entra nella vista; se nessun campo del passo lo mostra, si porta in vista
    // l'avviso. La richiesta si consuma comunque, cosi' una modifica
    // successiva non sposta il fuoco mentre si scrive.
    if (fuocoRichiestoRef.current) {
      fuocoRichiestoRef.current = false;
      if (campi[0]) {
        campi[0].focus({ preventScroll: true });
        campi[0].scrollIntoView?.({ block: 'center' });
      } else {
        alertRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      }
    }

    // Le nostre modifiche toccano solo attributi aria e data, non la classe:
    // l'osservatore non si risveglia da se'.
    const osservatore = new MutationObserver(() => allinea());
    osservatore.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    return () => osservatore.disconnect();
  }, [fieldErrors, activeStep]);

  const updateForm = useCallback((patch: Partial<WizardForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── Draft autosave ────────────────────────────────────────────────────────
  // Persist the form to localStorage (debounced) so an accidental reload or
  // navigation doesn't lose all 5 steps. Keyed by event id (edit) or 'new'.
  // We skip the first render so a pristine form isn't stored as a "draft",
  // capture any pre-existing draft before the autosave can overwrite it, and
  // clear the key on a successful submit.
  const draftKey = `pa-wizard-draft:${initialEvent?.id ?? 'new'}`;
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* storage unavailable */
    }
  }, [draftKey]);

  const skipFirstAutosave = useRef(true);
  useEffect(() => {
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    const id = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(form));
      } catch {
        /* quota / unavailable — best effort */
      }
    }, 800);
    return () => clearTimeout(id);
  }, [form, draftKey]);

  const savedDraftRef = useRef<string | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        savedDraftRef.current = raw;
        setDraftAvailable(true);
      }
    } catch {
      /* ignore */
    }
    // Run once on mount for this draft key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDraft = useCallback(() => {
    if (savedDraftRef.current) {
      try {
        // Sopra il modulo di partenza, non al suo posto: una bozza salvata
        // prima che il modulo avesse un campo nuovo non lo lascerebbe vuoto.
        const salvata = JSON.parse(savedDraftRef.current) as Partial<WizardForm>;
        setForm((prima) => ({ ...prima, ...salvata }));
      } catch {
        /* corrupt draft — ignore */
      }
    }
    setDraftAvailable(false);
  }, []);
  const dismissDraft = useCallback(() => {
    clearDraft();
    setDraftAvailable(false);
  }, [clearDraft]);

  const stepIndex = STEP_KEYS.indexOf(activeStep);
  const goPrev = () => stepIndex > 0 && setActiveStep(STEP_KEYS[stepIndex - 1]!);
  const goNext = () => {
    const errs = validateStep(activeStep, form, props.defaultLocale, retentionMax);
    if (Object.keys(errs).length > 0) {
      chiaviClientRef.current = new Set(Object.keys(errs));
      fuocoRichiestoRef.current = true;
      setFieldErrors(errs);
      showError(t('validationFailed'));
      return;
    }
    setFieldErrors({});
    setSubmitError(null);
    if (stepIndex < STEP_KEYS.length - 1) setActiveStep(STEP_KEYS[stepIndex + 1]!);
  };

  /**
   * Il messaggio per una risposta di errore del server.
   *
   * Un 422 con `details` diventa campo evidenziato, salto al passo che lo
   * contiene e messaggio localizzato: il testo del server e' in inglese e
   * tecnico, e mostrato da solo in cima alla pagina non diceva ne' cosa ne'
   * dove correggere. Resta, dentro una frase localizzata, solo per gli errori
   * che nessun campo del wizard sa mostrare.
   */
  const serverErrorMessage = useCallback(
    (err: { error?: string; message?: string; details?: unknown }, status: number): string => {
      if (!Array.isArray(err.details)) {
        return err.error ?? err.message ?? `HTTP ${status}`;
      }
      const mapped = mapServerIssues(err.details, props.defaultLocale);
      chiaviClientRef.current = new Set();
      fuocoRichiestoRef.current = true;
      setFieldErrors(mapped.fieldErrors);
      if (mapped.step) setActiveStep(mapped.step);
      const parti: string[] = [];
      if (mapped.step) parti.push(t('validationFailed'));
      if (mapped.unmapped.length > 0 || parti.length === 0) {
        parti.push(
          t('validationFailedDetail', {
            reason: mapped.unmapped.join('; ') || err.error || `HTTP ${status}`,
          }),
        );
      }
      return parti.join('\n');
    },
    [props.defaultLocale, t],
  );

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
      setAzione(submitMode);
      // Validate every step before submitting (especially on publish).
      const aggregated: Record<string, string> = {};
      for (const key of STEP_KEYS) {
        Object.assign(aggregated, validateStep(key, form, props.defaultLocale, retentionMax));
      }
      if (submitMode === 'publish') {
        Object.assign(aggregated, validatePublish(form));
      }
      if (Object.keys(aggregated).length > 0) {
        chiaviClientRef.current = new Set(Object.keys(aggregated));
        fuocoRichiestoRef.current = true;
        setFieldErrors(aggregated);
        showError(t('validationFailed'));
        // Jump to the first failing step. Gli errori di validatePublish
        // (moderatorName/moderatorEmail) non sono coperti da validateStep e
        // i campi vivono nello step 'review': se solo quelli falliscono,
        // portiamo l'utente lì (altrimenti il messaggio resta senza campo
        // evidenziato visibile).
        const firstFailing = STEP_KEYS.find((k) =>
          Object.keys(validateStep(k, form, props.defaultLocale, retentionMax)).length > 0,
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
          waitingRoomEngine: form.waitingRoomEngine,
          videoQuality: form.videoQuality ?? null,
          expectedSenderRatioPct: form.expectedSenderRatioPct,

          // Permissions (matrix + derived booleans)
          permissionMatrix: form.permissionMatrix,
          qaEnabled: toggles.qaEnabled,
          chatEnabled: toggles.chatEnabled,
          participantsCanUnmute: toggles.participantsCanUnmute,
          participantsCanStartVideo: toggles.participantsCanStartVideo,
          participantsCanShareScreen: toggles.participantsCanShareScreen,
          recordingEnabled: form.recordingEnabled,
          agendaEnabled: form.agendaEnabled,
          wordCloudEnabled: form.wordCloudEnabled,
          whiteboardEnabled: form.whiteboardEnabled,
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
          // Conserva tracce: solo se il multitrack è effettivamente attivo.
          retainParticipantTracks:
            form.recordingEnabled &&
            form.aiTranscriptEnabled &&
            form.multitrackRecordingEnabled &&
            form.retainParticipantTracks,
          aiTargetLocales: form.aiTargetLocales,
          expectedSpeakers: form.expectedSpeakers,

          // Review step. In modifica si manda solo se cambiato: un valore
          // oltre il massimo, gia' salvato, il server non lo riaccetterebbe.
          dataRetentionDays:
            mode === 'edit' && form.dataRetentionDays === initialRetention
              ? undefined
              : form.dataRetentionDays,
          gdprTemplateId: form.gdprTemplateId,
          // In modifica solo se cambiato qui: la pagina dell'evento ha il suo
          // interruttore, e un salvataggio del wizard non deve rimettere un
          // valore letto prima.
          postEventPublic:
            mode === 'edit' && form.postEventPublic === initialEvent?.event.postEventPublic
              ? undefined
              : form.postEventPublic,
          // La stringa vuota si spedisce, non si trasforma in `undefined`: il
          // server scrive il campo solo quando è definito, e scegliere un
          // modello di informativa deve poter CANCELLARE il testo scritto a
          // mano. Altrimenti resterebbero valorizzati entrambi, e la pagina
          // di iscrizione dà la precedenza al testo: il modello scelto non
          // entrerebbe mai in vigore, senza che niente lo dica.
          privacyPolicyText: form.privacyPolicyText?.trim() ?? undefined,
          // In modifica, togliere il documento dell'informativa manda null:
          // altrimenti l'ultimo indirizzo resterebbe in vigore e avrebbe la
          // precedenza sull'informativa predefinita dell'installazione.
          privacyPolicyUrl:
            form.privacyPolicyUrl || (mode === 'edit' ? null : undefined),
          moderatorName: form.moderatorName?.trim() || undefined,
          moderatorEmail: form.moderatorEmail?.trim() || undefined,
        };

        // ── Edit mode: PUT the event, diff-based fan-out, then redirect
        //    back to the event detail page. Everything below the `return`
        //    is the "create" branch.
        if (mode === 'edit' && initialEvent) {
          const eventId = initialEvent.id;
          const moderatorToken = initialEvent.moderatorToken;

          // Il token solo nell'intestazione: nell'indirizzo finirebbe nei log.
          const putRes = await fetch(
            `/api/events/${eventId}`,
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
            throw new Error(serverErrorMessage(err, putRes.status));
          }

          const report = await fanoutEditDiff(
            eventId,
            moderatorToken,
            form,
            snapshotRef.current ?? initialEvent,
            props.defaultLocale,
          );

          // Non si cancella la bozza e non si naviga via: il testo digitato
          // deve restare recuperabile, altrimenti l'avviso direbbe di
          // sistemare qualcosa che non esiste piu'. L'errore viene reso
          // come avviso persistente nella pagina, non come notifica che
          // svanisce: dice che una modifica NON e' stata salvata.
          //
          // Le revoche mancate vengono prima e per nome: il collegamento di
          // quella persona e' ancora valido, e un nuovo salvataggio la
          // riprova (lo scatto non l'ha tolta).
          const avvisi = report.revocationFailed.map((name) =>
            t('revocationFailed', { name, tab: tDetail('tabs.people') }),
          );
          if (report.failed.length > 0) {
            const risorse = [...new Set(report.failed)]
              .map((r) => t(`resources.${r}` as 'resources.materials'))
              .join(', ');
            avvisi.push(
              report.reason
                ? t('partialFailureEditDetail', {
                    items: risorse,
                    reason: report.reason,
                  })
                : t('partialFailureEdit', { items: risorse }),
            );
          }
          if (avvisi.length > 0) {
            throw new Error(avvisi.join('\n'));
          }

          clearDraft();
          router.push(percorso(eventAdminPath(eventId, { viaToken })));
          return;
        }

        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(serverErrorMessage(err, res.status));
        }
        const created = (await res.json()) as { id: string; slug: string };

        // Fan-out: side resources (organizers, invitations). Moderator
        // token is needed for the organizers POST — we can grab it from
        // the response.
        const moderatorToken = (created as { moderatorToken?: string }).moderatorToken;

        // Track side-resource failures so we can warn the admin instead of
        // silently dropping invites/moderators/materials. They can re-add them
        // on the event page — but only if they know something didn't save.
        // Le risorse non salvate, per tipo (`admin.wizard.resources.*`).
        const failed = new Set<UnsavedResource>();

        // 1) Organizers (primary-moderator auth)
        for (const org of form.organizers) {
          const ok = await fetch(`/api/events/${created.id}/organizers`, {
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
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('organizers');
        }

        // 2) Invitations (admin-session auth)
        for (const inv of form.invitations) {
          const ok = await fetch(`/api/admin/events/${created.id}/invitations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: inv.email,
              name: inv.name,
              role: inv.role,
              personId: inv.personId ?? undefined,
            }),
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('invitations');
        }

        // 3) Moderators (EventModerator rows, MODERATOR role)
        for (const mod of form.moderators) {
          const ok = await fetch(`/api/events/${created.id}/moderators`, {
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
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('moderators');
        }

        // 4) Speakers (additional EventModerator rows, SPEAKER role)
        for (const sp of form.speakers) {
          const ok = await fetch(`/api/events/${created.id}/moderators`, {
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
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('speakers');
        }

        // 5) Materials
        for (const m of form.materials) {
          const ok = await fetch(`/api/admin/events/${created.id}/materials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(materialPayload(m)),
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('materials');
        }

        // 5) Questionnaires (pre/post). Il rifiuto confluisce nello stesso
        //    elenco delle altre risorse: finora era l'unico del gruppo a
        //    sparire in silenzio, ed e' quello che fallisce piu' spesso —
        //    basta una domanda estemporanea incompleta.
        const reportQ = newFanoutReport();
        await submitQuestionnaire(
          reportQ,
          created.id,
          'PRE_REGISTRATION',
          form.preEventQuestionnaire,
          props.defaultLocale,
        );
        await submitQuestionnaire(
          reportQ,
          created.id,
          'POST_EVENT',
          form.postEventQuestionnaire,
          props.defaultLocale,
        );
        if (reportQ.failed.length > 0) failed.add('questionnaires');

        // 6) Promote from DRAFT → PUBLISHED if requested. The create
        //    endpoint currently doesn't accept status; use PUT on the
        //    detail route (the route only exports PUT, not PATCH).
        //    Una pubblicazione rifiutata e' un fallimento parziale come gli
        //    altri: l'evento esiste ma resta in bozza, e chi l'ha creato deve
        //    saperlo invece di credere che sia online.
        let publishProblem: { reason: string | null } | null = null;
        if (submitMode === 'publish') {
          const pubRes = await fetch(`/api/events/${created.id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({ status: 'PUBLISHED' }),
          }).catch(() => null);
          if (!pubRes) {
            publishProblem = { reason: null };
          } else if (!pubRes.ok) {
            // La risposta del server, senza portare a un campo: la pagina sta
            // per cambiare, l'avviso sopravvive solo come notifica.
            const err = (await pubRes.json().catch(() => ({}))) as {
              error?: string;
              message?: string;
            };
            publishProblem = { reason: err.error ?? err.message ?? `HTTP ${pubRes.status}` };
          }
        }

        // Le risorse non salvate e una pubblicazione fallita: sulla pagina di
        // gestione le dice il riepilogo dell'evento appena creato, che resta
        // finche' non lo si chiude. Verso un'altra pagina, o se il browser non
        // conserva l'esito, un avviso, che sopravvive al cambio di pagina.
        const esitoConservato =
          !overrideRedirect &&
          rememberCreation(created.id, { unsaved: [...failed], publishFailed: publishProblem !== null });
        if (failed.size > 0 && !esitoConservato) {
          toast.error(
            t('partialFailure', { items: [...failed].map((k) => t(`resources.${k}`)).join(', ') }),
          );
        }
        if (publishProblem) {
          toast.error(
            publishProblem.reason
              ? t('publishFailedDetail', { reason: publishProblem.reason })
              : t('publishFailed'),
          );
        }

        clearDraft();

        // La pagina dell'evento, con la sessione dello staff che ha appena
        // creato l'evento (il wizard la richiede, e chi crea l'evento lo
        // gestisce): il token, credenziale che non scade, resta fuori dalla
        // barra degli indirizzi e dalla cronologia.
        let destination = `/admin/events/${created.id}?created=1`;
        if (overrideRedirect === '__questionnaires__') {
          destination = `/admin/events/${created.id}/questionnaires`;
        } else if (overrideRedirect) {
          destination = overrideRedirect;
        }
        router.push(percorso(destination));
      } catch (e) {
        showError(e instanceof Error && e.message ? e.message : tc('errorGeneric'));
      } finally {
        setSubmitting(false);
      }
    },
    [
      form,
      router,
      toast,
      clearDraft,
      viaToken,
      props.defaultLocale,
      t,
      tc,
      tDetail,
      mode,
      initialEvent,
      initialRetention,
      retentionMax,
      showError,
      serverErrorMessage,
    ],
  );

  const saveDraftAndNavigate = useCallback(
    async (destination: string) => {
      await handleSubmit('draft', destination);
    },
    [handleSubmit],
  );

  return (
    <div>
      {draftAvailable && (
        <div
          className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2"
          role="status"
        >
          <span>{t('draftFound')}</span>
          <span className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={restoreDraft}
            >
              {t('draftRestore')}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={dismissDraft}
            >
              {t('draftDiscard')}
            </button>
          </span>
        </div>
      )}

      <StepNav
        steps={STEP_KEYS.map((k) => ({ key: k, label: t(`steps.${k}`) }))}
        activeStep={activeStep}
        onJump={(k) => setActiveStep(k)}
        ariaLabel={t('stepsAriaLabel')}
      />

      {submitError && (
        <div
          ref={alertRef}
          className="alert alert-danger mt-3"
          role="alert"
          // Piu' avvisi (una revoca mancata per persona) vanno su righe diverse.
          style={{ whiteSpace: 'pre-line' }}
        >
          {submitError}
        </div>
      )}

      <div
        className="mt-4"
        ref={contentRef}
        tabIndex={-1}
        role="group"
        aria-label={t(`steps.${activeStep}`)}
        style={{ outline: 'none' }}
      >
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
            siteDefaultVideoQuality={props.siteDefaultVideoQuality}
          />
        )}
        {activeStep === 'permissions' && (
          <Step2Permissions
            value={form}
            onChange={updateForm}
            fieldErrors={fieldErrors}
            whiteboardInfraReady={props.whiteboardInfraReady}
            defaultTargetLocales={props.defaultTargetLocales}
            aiPipelineEnabled={props.aiPipelineEnabled ?? true}
            eventLocale={SOURCE_LANGUAGE_FALLBACK}
          />
        )}
        {activeStep === 'invites' && (
          <RubricaAccessContext.Provider value={props.canUseRubrica ?? false}>
            <Step3Invites
              value={form}
              onChange={updateForm}
              invitationsLocked={viaToken !== null}
              primaryModeratorEmail={form.moderatorEmail}
            />
          </RubricaAccessContext.Provider>
        )}
        {activeStep === 'content' && (
          <Step4Content
            value={form}
            onChange={updateForm}
            onSaveDraftAndNavigate={mode === 'create' ? saveDraftAndNavigate : undefined}
            submitting={submitting}
            staffLocked={viaToken !== null}
            defaultFeedbackHint={mode === 'create'}
          />
        )}
        {activeStep === 'review' && (
          <Step5Review
            form={form}
            onChange={updateForm}
            jvbSizingConfig={props.jvbSizingConfig}
            defaultSenderRatioPct={props.defaultSenderRatioPct}
            defaultLocale={props.defaultLocale}
            gdprTemplates={props.gdprTemplates}
            fieldErrors={fieldErrors}
            prefilledModeratorEmail={mode === 'edit' ? null : props.defaultModerator?.email ?? null}
            retentionMax={retentionMax}
            showLinksOnPublish={mode === 'create' || initialEvent?.event.status === 'DRAFT'}
          />
        )}
      </div>

      {riepilogo.length > 0 && (
        <div className="mt-4 small" role="status">
          <span className="fw-semibold me-2">{t('toFix')}</span>
          {riepilogo.map((etichetta, i) => (
            <button
              key={`${i}-${etichetta}`}
              type="button"
              className="btn btn-link btn-sm p-0 me-3 align-baseline"
              onClick={() => {
                const el = campiNonValidiRef.current[i];
                el?.focus({ preventScroll: true });
                el?.scrollIntoView?.({ block: 'center' });
              }}
            >
              {etichetta || t('toFixField', { n: i + 1 })}
            </button>
          ))}
        </div>
      )}

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
          <div className="d-flex gap-2 flex-wrap justify-content-end">
            {/* In modifica si salva da qualunque passo: cambiare
                un'impostazione non obbliga a percorrere tutto il wizard. */}
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => handleSubmit('draft')}
                disabled={submitting}
              >
                {submitting && azione === 'draft' ? tc('saving') : t('updateEvent')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={submitting}
            >
              {tc('next')} →
            </button>
          </div>
        ) : mode === 'edit' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit('draft')}
            disabled={submitting}
          >
            {submitting && azione === 'draft' ? tc('saving') : t('updateEvent')}
          </button>
        ) : (
          <div className="d-flex gap-2">
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => handleSubmit('draft')}
              disabled={submitting}
            >
              {submitting && azione === 'draft' ? tc('saving') : t('saveDraft')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSubmit('publish')}
              disabled={submitting}
            >
              {submitting && azione === 'publish' ? tc('saving') : t('publish')}
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
  ariaLabel,
}: {
  steps: Array<{ key: StepKey; label: string }>;
  activeStep: StepKey;
  onJump: (k: StepKey) => void;
  ariaLabel: string;
}) {
  const activeIdx = steps.findIndex((s) => s.key === activeStep);
  return (
    <nav aria-label={ariaLabel} className="mb-3">
      <ol className="d-flex align-items-center justify-content-between list-unstyled mb-0 flex-wrap gap-2">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          // Il passo gia' fatto: cerchio bianco con bordo e segno blu (il bianco
          // su un azzurro chiaro non arrivava al contrasto minimo, e un fondo
          // chiaro si confonderebbe con i passi da fare).
          const bg = isActive ? '#0066CC' : isDone ? '#fff' : '#DEE5EC';
          const color = isActive ? '#fff' : isDone ? '#0066CC' : 'var(--app-text)';
          return (
            <li key={s.key} className="flex-grow-1">
              <button
                type="button"
                onClick={() => onJump(s.key)}
                aria-current={isActive ? 'step' : undefined}
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
                    border: isDone ? '2px solid #0066CC' : 'none',
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
