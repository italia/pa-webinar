'use client';

/**
 * Il wizard dell'evento, in cinque passi semplici:
 *
 *   1. Evento      — titolo, descrizione, copertina, categorie
 *   2. Quando      — date e fuso, partecipanti attesi, ricorrenza
 *   3. Persone     — organizzatore principale, enti, persone con un ruolo,
 *                    invitati
 *   4. Programma   — facoltativo: gli argomenti, chi interviene, le durate
 *                    (non per le chiamate istantanee, che non hanno pagina)
 *   5. Riepilogo   — cio' che manca, l'evento e le scelte del modello in
 *                    schede, l'informativa; bozza o pubblicazione
 *
 * e, a parte, le impostazioni avanzate: tutto cio' che il modello ha gia'
 * scelto (partecipazione, registrazione e AI, contenuti, sala d'attesa e
 * video, dati, dettagli tecnici), in sezioni richiudibili. I campi
 * obbligatori si fanno notare finche' sono vuoti, e la barra dei passi dice
 * quali passi sono da completare. I passi condividono un solo stato
 * (`WizardForm`), che alla conferma va a /api/events. Dopo la creazione, enti,
 * persone e invitati vanno alle loro API (l'evento a quel punto ha un id).
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';

import { useRouter, percorso } from '@/i18n/navigation';
import { useToast } from '@/components/ui/toast';
import { profiloSalvato } from '@/lib/events/grant-profile';
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
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';
import { presetForEditing } from '@/lib/utils/recurrence';
import { lingueDiPartenzaTraduzione, parseLocaleList } from '@/lib/ai/target-locales';
import type { CapacitaIstanza } from '@/lib/capacity/model';
import type { VideoQualityPreset } from '@/lib/jitsi/config';
import {
  passiPrincipali,
  passoDisponibile,
  wizardStepFromParam,
  type WizardAdvancedSection,
} from '@/lib/events/wizard-steps';
import { publicRegistrationFor } from '@/lib/events/access-mode';
import type { StatoTestiEvento } from '@/lib/text-translation/auto';
import { entroILimiti, haTesto } from '@/lib/text-translation/stato-lingue';

import { RubricaAccessContext } from '../rubrica-picker';

import {
  fanoutEditDiff,
  materialPayload,
  newFanoutReport,
  submitQuestionnaire,
} from './edit-fanout';
import { rememberCreation, type UnsavedResource } from './created-event';
import StepProgramma from './programme-section';
import ProgrammeCard from './programme-card';
import {
  agendaDalServer,
  concessioneDaChiave,
  conIdSalvati,
  haTitolo,
  istanteDalModulo,
  pianoDaInviare,
  senzaRelatoriAssenti,
  type StepProgrammeValue,
  type VoceSalvata,
} from './programme-plan';
import {
  PannelloLingua,
  RigaLingue,
  testoPrincipale,
  useAspettoSchede,
  useLingueEvento,
} from './text-translation';
import { BOZZA_NUOVO_KEY, TRASLOCO_KEY, TRASLOCO_VALIDO_MS } from './drafts';
import {
  LibreriaDomandeProvider,
  RiepilogoQuestionari,
  RigheQuestionari,
  useStatoLibreriaDomande,
} from './libreria-domande';
import PagePreview, { datiAnteprima } from './page-preview';
import Step1Base, { type Step1Value } from './step-1-base';
import StepPermissions, { type StepPermissionsValue } from './step-3-permissions';
import StepPeople, {
  PrimarySection,
  SezioneIscrizione,
  type StepPeopleValue,
} from './step-2-people';
import Step4Content, {
  type QuestionnaireBlock,
  type QuestionnaireResponseCounts,
  type Step4Value,
} from './step-4-content';
import Step5Review from './step-5-review';
import AdvancedSettings, {
  SezioneDati,
  SezioneTecnica,
  riepilogoCapacita,
} from './advanced-settings';
import {
  STEP_KEYS,
  campiMancanti,
  mapServerIssues,
  validatePublish,
  validateStep,
  type CampoMancante,
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
  liveCaptionsEnabled?: boolean;
  captionsTranscriptEnabled?: boolean;
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
  /** Chi partecipa: chiunque si iscrive, o solo gli invitati. */
  accessMode?: EventAccessModeValue | null;
}

/** Chi partecipa a un evento (Event.accessMode); null = come dice il sito. */
export type EventAccessModeValue = 'OPEN' | 'INVITATION';

export interface WizardProps {
  template?: WizardTemplatePreset | null;
  siteTimezone: string;
  enabledLocales: string[];
  defaultLocale: string;
  defaultRetentionDays: number;
  /** Mostrare la ricerca in rubrica negli inviti: solo all'amministrazione. */
  canUseRubrica?: boolean;
  /** Si possono creare categorie nuove (le categorie sono del sito: solo
   *  l'amministrazione). */
  canManageTags?: boolean;
  /** In modifica, il token con cui si e' entrati se non c'e' una sessione dello
   *  staff: solo allora il ritorno alla pagina dell'evento lo porta con se'. */
  viaToken?: string | null;
  /** L'istanza per la stima della capacita' (lib/capacity/istanza). */
  capacita: CapacitaIstanza;
  availableTags: Array<{
    slug: string;
    name: Record<string, string>;
    color: string | null;
  }>;
  gdprTemplates: Array<{ id: string; name: string; isDefault: boolean }>;
  /** Site-wide default for the title-kicker parse. Used to decide whether
   *  to surface the per-event override in step 1 (hidden when already on). */
  siteDefaultParseTitleKicker: boolean;
  /** Site-wide default video/audio quality, shown as the resolved value
   *  for the per-event override in step 1. */
  siteDefaultVideoQuality: VideoQualityPreset;
  /** Se l'installazione ha il servizio della lavagna di Jitsi
   *  (`resolveWhiteboardInfraReady`, letto dalla pagina server). Senza, la
   *  sala non mostra la lavagna e il passo Permessi non la offre. */
  whiteboardInfraReady: boolean;
  /** I sottotitoli live ci sono nell'installazione: accesi nelle
   *  impostazioni e con il servizio installato (lib/captions/availability).
   *  Senza, l'interruttore dell'evento non si mostra. */
  liveCaptionsAvailable?: boolean;
  /** Le lingue di traduzione predefinite dell'istanza (SiteSetting). */
  defaultTargetLocales?: string | null;
  /** La post-produzione AI e' accesa sull'installazione: spenta, il passo Permessi
   *  non ne propone le funzioni. */
  aiPipelineEnabled?: boolean;
  /** La traduzione automatica di titolo e descrizione c'e' nell'installazione
   *  (pipeline AI accesa, motore di traduzione su CPU installato): il passo
   *  «Evento» dice che le lingue senza testo si traducono al salvataggio. */
  textTranslationAvailable?: boolean;
  /** In modifica: lo stato delle lingue dell'evento, letto dal server
   *  (lib/text-translation/auto statoTestiEvento). */
  statoLingueIniziale?: StatoTestiEvento | null;
  /** Chi apre il wizard amministra l'istanza: a motore spento vede dove
   *  accenderlo. */
  isSiteAdmin?: boolean;
  /** In modifica: relatori e organizzatore scritti a mano (eventi di prima
   *  delle persone strutturate), che la pagina mostra ancora e l'anteprima
   *  quindi pure. */
  campiLiberi?: { speakersInfo: Record<string, string> | null; organizerName: string | null };
  /** In modifica: il passo da cui partire (i link «Modifica» della pagina
   *  dell'evento portano dritti a quello che serve). */
  initialStep?: StepKey | 'permissions' | 'content';
  /** In modifica: la sezione delle impostazioni avanzate da aprire. */
  initialSection?: WizardAdvancedSection;
  /** Il moderatore principale di partenza di un evento nuovo: chi lo crea,
   *  quando entra con un account nominale. */
  defaultModerator?: { name: string; email: string } | null;
  /** L'iscrizione pubblica dell'installazione (SiteSetting): dice che cosa
   *  vuol dire l'elenco degli invitati nel passo «Persone». */
  publicRegistrationEnabled?: boolean;
  /** When `'edit'`, the wizard seeds state from `initialEvent`, PUTs to
   *  /api/events/:id on submit, and redirects to the admin detail page.
   *  When `'create'` (default), it POSTs to /api/events and falls into the
   *  classic post-create redirect. */
  mode?: 'create' | 'edit';
  /** Required when `mode === 'edit'`. Fully-loaded event + related
   *  entities so the wizard can diff on submit. */
  initialEvent?: InitialEventShape;
  /** In creazione: torna alla scelta del formato (o del modello), con chi
   *  partecipa come lo si vede ora (cambiato magari nel passo «Persone»). */
  onChangeTemplate?: (stato: { invitati: boolean }) => void;
  /** I valori di partenza vengono dalle quattro domande del formato, riassunte
   *  qui: la fascia in cima le dice al posto del nome di un modello. */
  formatoLabel?: string;
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
    liveCaptionsEnabled?: boolean | null;
    captionsTranscriptEnabled?: boolean | null;
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
    moderatorOrganization: string | null;
    moderatorOrganizationLogoUrl: string | null;
    moderatorPublicListed: boolean;
    moderatorPhotoId: string | null;
    /** Una chiamata istantanea non ha iscrizione. */
    eventType?: string;
    accessMode: EventAccessModeValue | null;
    requireOrganization: boolean;
    requireOrganizationRole: boolean;
    requireOrganizationType: boolean;
  };
  /** Each organizer with its DB id so we can DELETE on removal. */
  organizers: Array<{
    id: string;
    name: string;
    logoUrl: string | null;
    websiteUrl: string | null;
  }>;
  /** Le concessioni (ruoli MODERATOR e SPEAKER): riempiono l'elenco delle
   *  persone del passo «Persone». */
  eventModerators: Array<{
    id: string;
    name: string;
    email: string | null;
    role: 'MODERATOR' | 'SPEAKER';
    personId: string | null;
    organizer: boolean;
    organization: string | null;
    organizationLogoUrl: string | null;
    publicListed: boolean;
    photoId: string | null;
    /** La concessione creata per un cambio di ruolo, al posto di questa. */
    replaces?: string;
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
  /** Le risposte gia' raccolte dai due questionari: con risposte, il wizard
   *  non li cambia ne' li svuota (vedi edit-fanout). */
  questionnaireResponses?: QuestionnaireResponseCounts;
  /** Il programma salvato (gli argomenti dell'agenda, in ordine). */
  agenda?: VoceSalvata[];
  /** L'agenda e' gia' stata usata in sala (un argomento non piu' da
   *  discutere, o con le reazioni del pubblico): il wizard non la cambia. */
  agendaLocked?: boolean;
}

export interface Step5ReviewFields {
  dataRetentionDays: number;
  /** Event.postEventPublic: la pagina dell'evento concluso resta visibile. */
  postEventPublic: boolean;
  gdprTemplateId: string | null;
  privacyPolicyText: string;
  privacyPolicyUrl: string | null;
  /** L'organizzatore principale (passo «Persone»): riceve il link condiviso. */
  moderatorName: string;
  moderatorEmail: string;
  /** Il suo ente e se la pagina pubblica lo presenta fra chi organizza. */
  moderatorOrganization: string | null;
  moderatorOrganizationLogoUrl: string | null;
  moderatorPublicListed: boolean;
  /** La sua foto (EventPersonPhoto), caricata dallo staff. */
  moderatorPhotoId: string | null;
  /** Chi partecipa (passo «Persone»): null = come dice il sito. */
  accessMode: EventAccessModeValue | null;
  /** Cosa si chiede a chi si iscrive, oltre a nome ed email. */
  requireOrganization: boolean;
  requireOrganizationRole: boolean;
  requireOrganizationType: boolean;
}

/** La bozza nel browser: il modulo e le lingue toccate quando la si e' scritta. */
type BozzaDelModulo = WizardForm & { lingueToccate?: string[] };

export type WizardForm = Step1Value &
  StepPermissionsValue &
  StepPeopleValue &
  StepProgrammeValue &
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
  // Le etichette le cambia lo staff dell'evento: con un link di conduzione il
  // passo non le propone (e il salvataggio non le manda).
  // Le categorie create dal wizard si aggiungono all'elenco, gia' scelte.
  const [etichetteCreate, setEtichetteCreate] = useState<WizardProps['availableTags']>([]);
  const etichette = viaToken !== null ? [] : [...props.availableTags, ...etichetteCreate];
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
  // Le risposte dei questionari come le conosce l'ultimo salvataggio: un
  // rifiuto per risposte arrivate a wizard aperto rende subito il blocco di
  // sola lettura, invece di lasciarlo modificabile senza effetto.
  const [risposteQuestionari, setRisposteQuestionari] = useState(
    initialEvent?.questionnaireResponses,
  );

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
    // Durata predefinita dal modello: chi crea l'evento imposta solo l'inizio
    // e la fine e' calcolata. Un modello senza durata, o nessun modello:
    // un'ora.
    const defaultDurationMin = props.template?.defaultDurationMinutes ?? 60;
    const defaultEnd = new Date(defaultStart.getTime() + defaultDurationMin * 60_000);
    // Le lingue dell'evento: quelle salvate (o del modello); senza, quelle
    // predefinite dell'istanza, senza la lingua principale. Il wizard le
    // salva sempre, anche nessuna (''): null vorrebbe dire «quelle del sito».
    const lingueDiPartenza = (lingue: string | null | undefined): string =>
      lingue ?? lingueDiPartenzaTraduzione(props.defaultTargetLocales, props.defaultLocale) ?? '';
    if (mode === 'edit' && initialEvent) {
      const ev = initialEvent.event;
      // La matrice salvata; se manca (eventi più vecchi), la si ricava dai
      // permessi singoli, così il passo «Permessi» mostra lo stato effettivo.
      const matrix: PermissionMatrix =
        (ev.permissionMatrix && coerceMatrix(ev.permissionMatrix)) ??
        matrixFromToggles({
          qaEnabled: ev.qaEnabled,
          chatEnabled: ev.chatEnabled,
          participantsCanUnmute: ev.participantsCanUnmute,
          participantsCanStartVideo: ev.participantsCanStartVideo,
          participantsCanShareScreen: ev.participantsCanShareScreen,
        });

      const ricorrenzaSalvata = presetForEditing(ev.recurrenceRule, new Date(ev.startsAt));

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
        recurrencePreset: ricorrenzaSalvata.preset,
        recurrenceUntil: ricorrenzaSalvata.until,
        recurrenceCount: ricorrenzaSalvata.count,
        parseTitleKicker: ev.parseTitleKicker,
        waitingRoomEngine: ev.waitingRoomEngine,
        videoQuality: ev.videoQuality,
        expectedSenderRatioPct: ev.expectedSenderRatioPct,

        // Passo Permessi
        permissionMatrix: matrix,
        recordingEnabled: ev.recordingEnabled,
        agendaEnabled: ev.agendaEnabled ?? false,
        wordCloudEnabled: ev.wordCloudEnabled ?? false,
        whiteboardEnabled: ev.whiteboardEnabled ?? false,
        liveCaptionsEnabled: ev.liveCaptionsEnabled ?? true,
        captionsTranscriptEnabled: ev.captionsTranscriptEnabled ?? false,
        autoStartRecording: ev.autoStartRecording,
        aiTranscriptEnabled: ev.aiTranscriptEnabled ?? false,
        aiSummaryEnabled: ev.aiSummaryEnabled ?? false,
        aiTranslationEnabled: ev.aiTranslationEnabled ?? false,
        aiDubbingEnabled: ev.aiDubbingEnabled ?? false,
        multitrackRecordingEnabled: ev.multitrackRecordingEnabled ?? false,
        retainParticipantTracks: ev.retainParticipantTracks ?? false,
        aiTargetLocales: lingueDiPartenza(ev.aiTargetLocales),
        expectedSpeakers: ev.expectedSpeakers ?? null,

        // Passo Persone — elenchi dalle entità collegate.
        organizers: initialEvent.organizers.map((o) => ({
          name: o.name,
          logoUrl: o.logoUrl,
          websiteUrl: o.websiteUrl,
        })),
        moderators: initialEvent.eventModerators
          .filter((m) => m.role === 'MODERATOR')
          .map((m) => ({
            grantId: m.id,
            name: m.name,
            email: m.email ?? '',
            personId: m.personId,
            organizer: m.organizer,
            organization: m.organization,
            organizationLogoUrl: m.organizationLogoUrl,
            publicListed: m.publicListed,
            photoId: m.photoId,
          })),
        speakers: initialEvent.eventModerators
          .filter((m) => m.role === 'SPEAKER')
          .map((m) => ({
            grantId: m.id,
            name: m.name,
            email: m.email ?? '',
            personId: m.personId,
            organization: m.organization,
            organizationLogoUrl: m.organizationLogoUrl,
            publicListed: m.publicListed,
            photoId: m.photoId,
          })),
        invitations: initialEvent.invitations.map((i) => ({
          name: i.name,
          email: i.email,
          role: i.role,
          personId: i.personId,
        })),
        // Il programma, con chi interviene tradotto nelle chiavi del modulo.
        agenda: agendaDalServer(initialEvent.agenda ?? [], initialEvent.eventModerators),

        // Step 4
        materials: initialEvent.materials.map((m) => ({
          title: m.title,
          url: m.url,
          description: m.description,
          type: m.type,
          visibility: m.visibility,
        })),
        preEventQuestionnaire: initialEvent.preEventQuestionnaire ?? {
          templateIds: [],
          adhocQuestions: [],
        },
        postEventQuestionnaire: initialEvent.postEventQuestionnaire ?? {
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
        moderatorOrganization: ev.moderatorOrganization ?? null,
        moderatorOrganizationLogoUrl: ev.moderatorOrganizationLogoUrl ?? null,
        moderatorPublicListed: ev.moderatorPublicListed ?? false,
        moderatorPhotoId: ev.moderatorPhotoId ?? null,
        accessMode: ev.accessMode,
        requireOrganization: ev.requireOrganization,
        requireOrganizationRole: ev.requireOrganizationRole,
        requireOrganizationType: ev.requireOrganizationType,
      } satisfies WizardForm;
    }

    const tpl = props.template;
    const conAi = (tpl?.recordingEnabled ?? false) && (props.aiPipelineEnabled ?? true);
    // Le lingue dell'evento, del modello o dell'istanza. La traduzione di
    // sottotitoli e sintesi parte solo se ce n'e' almeno una: senza, il
    // wizard chiederebbe di scegliere lingue che nessuno ha chiesto.
    const lingueDelModello = lingueDiPartenza(tpl?.aiTargetLocales);
    // La matrice dal modello: quella salvata, se c'è; altrimenti (il caso
    // comune: i modelli salvano i permessi singoli) la si ricava da quelli,
    // perché le scelte del modello arrivino al passo «Permessi». Ripiegare su
    // defaultMatrix() perderebbe in silenzio i permessi di ogni modello.
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
      // Con la traduzione automatica l'inglese del modello non si propone: e'
      // uno schema, non la traduzione di questo evento, e al salvataggio la
      // lingua vuota si traduce dal testo principale.
      description: {
        it: tpl?.descriptionTemplate?.it ?? '',
        en: props.textTranslationAvailable ? '' : (tpl?.descriptionTemplate?.en ?? ''),
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

      // Passo Permessi
      permissionMatrix: matrix,
      recordingEnabled: tpl?.recordingEnabled ?? false,
      agendaEnabled: tpl?.agendaEnabled ?? false,
      wordCloudEnabled: tpl?.wordCloudEnabled ?? false,
      whiteboardEnabled: tpl?.whiteboardEnabled ?? false,
      // Accesi finche' un modello non li spegne, come sugli eventi.
      liveCaptionsEnabled: tpl?.liveCaptionsEnabled ?? true,
      captionsTranscriptEnabled: tpl?.captionsTranscriptEnabled ?? false,
      // La registrazione non parte mai da sola: la avvia chi conduce con il
      // pulsante REC, qualunque cosa dica un modello salvato prima.
      autoStartRecording: false,
      // Default AI dal template (semplificazione): un template "registrato"
      // può pre-attivare trascrizione/sintesi. La trascrizione richiede la
      // registrazione, quindi la attiviamo solo se recordingEnabled, e solo
      // se l'elaborazione AI e' attiva sull'istanza (conAi): altrimenti un
      // template la accenderebbe senza che nessuno la esegua. Lo stesso per
      // le tracce per partecipante, che servono alla trascrizione.
      aiTranscriptEnabled: conAi && (tpl?.aiTranscriptEnabled ?? false),
      aiSummaryEnabled:
        conAi && (tpl?.aiTranscriptEnabled ?? false) && (tpl?.aiSummaryEnabled ?? false),
      aiTranslationEnabled:
        conAi &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.aiTranslationEnabled ?? false) &&
        !!lingueDelModello,
      // Presi dal template, non piu' cablati a false: e' qui che la
      // configurazione di una serie si perdeva. La registrazione per
      // partecipante resta subordinata alla registrazione video, come per la
      // trascrizione qui sopra: catturare le tracce di chi parla senza che
      // l'evento sia registrato non ha senso e sarebbe una raccolta di dati
      // personali senza scopo.
      aiDubbingEnabled:
        conAi && (tpl?.aiTranscriptEnabled ?? false) && (tpl?.aiDubbingEnabled ?? false),
      multitrackRecordingEnabled:
        conAi &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.multitrackRecordingEnabled ?? false),
      retainParticipantTracks:
        conAi &&
        (tpl?.aiTranscriptEnabled ?? false) &&
        (tpl?.multitrackRecordingEnabled ?? false) &&
        (tpl?.retainParticipantTracks ?? false),
      aiTargetLocales: lingueDelModello,
      expectedSpeakers: tpl?.defaultExpectedSpeakers ?? null,

      // Passo Persone
      organizers: [],
      moderators: [],
      speakers: [],
      invitations: [],
      agenda: [],

      // Step 4
      materials: [],
      preEventQuestionnaire: { templateIds: [], adhocQuestions: [] },
      postEventQuestionnaire: { templateIds: [], adhocQuestions: [] },

      // Step 5 fields written here so review can surface them
      // Un template salvato prima del limite attuale puo' avere un valore piu'
      // alto: si riporta entro il massimo, altrimenti l'evento non si salva.
      dataRetentionDays: Math.min(
        tpl?.defaultRetentionDays ?? props.defaultRetentionDays,
        MAX_RETENTION_DAYS
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
      moderatorOrganization: null,
      moderatorOrganizationLogoUrl: null,
      moderatorPublicListed: false,
      moderatorPhotoId: null,
      accessMode: tpl?.accessMode ?? null,
      requireOrganization: false,
      requireOrganizationRole: false,
      requireOrganizationType: false,
    } satisfies WizardForm;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.template, mode, initialEvent]);

  const [form, setForm] = useState<WizardForm>(initial);
  // Il passo di partenza vale solo in modifica: in creazione si comincia
  // dall'inizio.
  // Quale pulsante ha avviato il salvataggio: solo lui dice «Salvataggio…».
  const [azione, setAzione] = useState<'draft' | 'publish' | null>(null);
  // Il passo di partenza, anche nominato come una volta (`permissions`,
  // `content`: ora sezioni delle impostazioni avanzate). Una chiamata
  // istantanea non ha il programma: chi lo chiede arriva a «Persone».
  const istantanea = initialEvent?.event.eventType === 'INSTANT';
  const partenza = mode === 'edit' ? wizardStepFromParam(props.initialStep) : null;
  const [activeStep, setActiveStep] = useState<StepKey>(
    partenza ? passoDisponibile(partenza.step, istantanea) : 'base',
  );
  const [submitting, setSubmitting] = useState(false);
  // I file in viaggio verso il server, da ogni campo dei passi e delle
  // impostazioni avanzate (foto delle persone, copertina, loghi, audio della
  // sala d'attesa, documento della privacy, materiali): finche' ce n'e' uno,
  // salvare o cambiare passo lo perderebbe (il campo smonta e interrompe il
  // caricamento, e il modulo non ha ancora il suo indirizzo).
  const [caricamentiInViaggio, setCaricamentiInViaggio] = useState(0);
  const segnalaCaricamento = useCallback((inCaricamento: boolean) => {
    setCaricamentiInViaggio((n) => Math.max(0, n + (inCaricamento ? 1 : -1)));
  }, []);
  const fermo = submitting || caricamentiInViaggio > 0;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Gli errori trovati nel browser: spariscono appena il campo torna valido.
  // Quelli del server restano fino al prossimo invio, perche' qui non si sa
  // ricontrollarli.
  const chiaviClientRef = useRef<Set<string>>(new Set());
  // Dopo un invio rifiutato il fuoco va al primo campo da correggere.
  const fuocoRichiestoRef = useRef(false);

  // La sezione aperta delle impostazioni avanzate, e quante volte la si e'
  // chiesta: chiederla di nuovo (un errore, un'altra scheda) la riapre anche
  // se la si era chiusa a mano.
  const [richiestaSezione, setRichiestaSezione] = useState(0);
  const [sezione, setSezione] = useState<WizardAdvancedSection | null>(
    mode === 'edit' ? (props.initialSection ?? partenza?.section ?? null) : null
  );
  const apriSezione = (sez: WizardAdvancedSection | null) => {
    setSezione(sez);
    setRichiestaSezione((n) => n + 1);
  };

  // La sezione letta all'arrivo nelle impostazioni avanzate: l'effetto del
  // cambio di passo la legge da qui, cosi' riparte solo al cambio di passo.
  const sezioneRef = useRef(sezione);
  sezioneRef.current = sezione;

  // On step change move focus to the step region and scroll it into view so
  // keyboard/screen-reader users aren't left on the footer button (and a
  // validation jump to a failing step is perceivable). Skip the first render.
  const contentRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    // Al primo giro il fuoco resta dov'e', salvo arrivando su una sezione
    // delle impostazioni avanzate (un link «Modifica» della pagina
    // dell'evento): la si porta in vista.
    const primo = firstRender.current;
    firstRender.current = false;
    if (primo && !(activeStep === 'advanced' && sezioneRef.current)) return;
    const el = contentRef.current;
    if (!el) return;
    // Se il passo ha gia' portato il fuoco su un suo elemento (il «Modifica»
    // della scheda da cui si era usciti), lo si lascia li'.
    if (
      document.activeElement &&
      document.activeElement !== el &&
      el.contains(document.activeElement)
    )
      return;
    // Nelle impostazioni avanzate aperte da una scheda: il fuoco e la vista
    // vanno alla sezione chiesta, non in cima alla pagina.
    const sezioneAperta = sezioneRef.current;
    if (activeStep === 'advanced' && sezioneAperta) {
      const titolo = el.querySelector<HTMLElement>(
        `#wiz-avanzate-${sezioneAperta} > summary`
      );
      if (titolo) {
        titolo.focus({ preventScroll: true });
        titolo.scrollIntoView?.({ block: 'start' });
        return;
      }
    }
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
    for (const k of STEP_KEYS)
      Object.assign(ancora, validateStep(k, form, props.defaultLocale, retentionMax));
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
        ...root.querySelectorAll<HTMLElement>(
          'input.is-invalid, textarea.is-invalid, select.is-invalid'
        ),
      ];
      const etichette: string[] = [];
      campi.forEach((el, i) => {
        if (!el.hasAttribute('data-wizard-invalid')) {
          el.setAttribute('data-wizard-invalid', '');
          el.setAttribute(
            'data-wizard-describedby',
            el.getAttribute('aria-describedby') ?? ''
          );
        }
        if (el.getAttribute('aria-invalid') !== 'true')
          el.setAttribute('aria-invalid', 'true');
        const messaggio =
          el.parentElement?.querySelector<HTMLElement>('.invalid-feedback');
        if (messaggio) {
          if (!messaggio.id) messaggio.id = `wizard-errore-${activeStep}-${i}`;
          const voluto = [el.getAttribute('data-wizard-describedby'), messaggio.id]
            .filter(Boolean)
            .join(' ');
          if (el.getAttribute('aria-describedby') !== voluto)
            el.setAttribute('aria-describedby', voluto);
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
        prima.length === etichette.length && prima.every((e, i) => e === etichette[i])
          ? prima
          : etichette
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
    osservatore.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => osservatore.disconnect();
  }, [fieldErrors, activeStep]);

  // Una persona tolta (nel passo «Persone») non interviene piu': le sue
  // scelte nel programma si tolgono subito, anche senza aprire il passo
  // «Programma» (senzaRelatoriAssenti). Vale anche per un modulo che arriva
  // intero (una bozza ripresa): le persone della bozza possono non essere
  // quelle del programma che resta. Un'agenda gia' usata in sala non si
  // tocca: si legge soltanto.
  const agendaBloccata = !!initialEvent?.agendaLocked;
  const conSceltePulite = useCallback(
    (modulo: WizardForm): WizardForm =>
      agendaBloccata ? modulo : senzaRelatoriAssenti(modulo).form,
    [agendaBloccata],
  );
  const updateForm = useCallback(
    (patch: Partial<WizardForm>) => {
      setForm((prev) => {
        const next = { ...prev, ...patch };
        return 'moderators' in patch || 'speakers' in patch ? conSceltePulite(next) : next;
      });
    },
    [conSceltePulite],
  );
  // Il passo «Programma», quando si apre, dice quanti argomenti hanno perso
  // chi interviene da quando lo si e' visto l'ultima volta: il confronto e'
  // con le scelte di allora (all'inizio, quelle di partenza). Una scelta
  // tolta a mano nel passo era gia' vista, e non conta.
  const agendaCorrenteRef = useRef(form.agenda);
  useEffect(() => {
    agendaCorrenteRef.current = form.agenda;
  }, [form.agenda]);
  const scelteVisteRef = useRef<Map<string, string | null>>(
    new Map((initial.agenda ?? []).map((v) => [v.key, v.speakerKey])),
  );
  const [righeSenzaRelatore, setRigheSenzaRelatore] = useState(0);
  useEffect(() => {
    if (activeStep !== 'programme') return;
    const viste = scelteVisteRef.current;
    setRigheSenzaRelatore(
      (agendaCorrenteRef.current ?? []).filter((v) => !v.speakerKey && !!viste.get(v.key)).length,
    );
    return () => {
      scelteVisteRef.current = new Map(
        (agendaCorrenteRef.current ?? []).map((v) => [v.key, v.speakerKey]),
      );
      setRigheSenzaRelatore(0);
    };
  }, [activeStep]);

  // La libreria dei modelli di domande: la leggono i passi che la mostrano,
  // una volta sola per tutto il wizard.
  const libreriaDomande = useStatoLibreriaDomande();

  // ── Lingue dell'evento e traduzione automatica di titolo e descrizione ───
  // Le lingue toccate in questa pagina (una modifica, «Segna come riletta»,
  // «È ancora corretta», una lingua tolta): al salvataggio sono di una
  // persona; delle altre il server tiene il testo che ha (textEdits).
  const [toccate, setToccate] = useState<ReadonlySet<string>>(() => new Set());
  const tocca = useCallback(
    (lingue: string[]) => {
      const nuove = lingue.filter((l) => l !== props.defaultLocale);
      if (nuove.length === 0) return;
      setToccate((prima) =>
        nuove.every((l) => prima.has(l)) ? prima : new Set([...prima, ...nuove])
      );
    },
    [props.defaultLocale]
  );
  const formRef = useRef(form);
  formRef.current = form;
  // Il testo principale come lo conosce il server: cambiato nel modulo, le
  // altre lingue non vengono piu' da lui.
  const [principaleSalvato, setPrincipaleSalvato] = useState(() =>
    testoPrincipale(props.defaultLocale, initial.title, initial.description)
  );
  // La traduzione automatica c'e' per questo evento: non per le chiamate
  // istantanee (non hanno una pagina) ne' per gli eventi archiviati.
  // Neanche per un testo principale oltre i limiti del motore.
  const motoreEvento =
    !!props.textTranslationAvailable &&
    initialEvent?.event.eventType !== 'INSTANT' &&
    initialEvent?.event.status !== 'ARCHIVED' &&
    entroILimiti(form.title[props.defaultLocale] ?? '', form.description[props.defaultLocale] ?? '');
  const lingueEvento = useMemo(
    () => parseLocaleList(form.aiTargetLocales),
    [form.aiTargetLocales]
  );
  // Una traduzione arrivata a pagina aperta entra nelle lingue non toccate.
  const toccateRef = useRef(toccate);
  toccateRef.current = toccate;
  const onArrivati = useCallback(
    (testi: StatoTestiEvento['testi']) => {
      setForm((prima) => {
        const title = { ...prima.title };
        const description = { ...prima.description };
        let cambiato = false;
        const lingue = new Set([
          ...Object.keys(testi.title),
          ...Object.keys(testi.description),
          ...Object.keys(prima.title),
          ...Object.keys(prima.description),
        ]);
        for (const l of lingue) {
          if (l === props.defaultLocale || toccateRef.current.has(l)) continue;
          const t = testi.title[l] ?? '';
          const d = testi.description[l] ?? '';
          if ((title[l] ?? '') !== t || (description[l] ?? '') !== d) {
            title[l] = t;
            description[l] = d;
            cambiato = true;
          }
        }
        return cambiato ? { ...prima, title, description } : prima;
      });
    },
    [props.defaultLocale]
  );
  const statoLingue = useLingueEvento({
    eventId: initialEvent?.id ?? null,
    iniziale: props.statoLingueIniziale ?? null,
    motore: motoreEvento,
    staff: viaToken === null,
    principale: props.defaultLocale,
    attive: props.enabledLocales,
    lingueEvento,
    titoli: form.title,
    descrizioni: form.description,
    toccate,
    principaleSalvato,
    onArrivati,
  });
  const aspettoSchede = useAspettoSchede(statoLingue.stati);
  const ricaricaLingue = statoLingue.ricarica;
  const scartaLetture = statoLingue.scarta;
  // Dopo «Segna come riletta», «È ancora corretta» o «Ritraduci» i pulsanti
  // del pannello spariscono: il fuoco va sulla scheda della lingua (il cui
  // nome dice il nuovo stato) invece di cadere sulla pagina, e la regione di
  // stato delle lingue lo annuncia.
  const annunciaStatoLingua = statoLingue.annunciaStato;
  const [schedaDaRaggiungere, setSchedaDaRaggiungere] = useState<string | null>(null);
  useEffect(() => {
    if (!schedaDaRaggiungere) return;
    setSchedaDaRaggiungere(null);
    annunciaStatoLingua(schedaDaRaggiungere);
    (
      document.getElementById(`ev-scheda-${schedaDaRaggiungere}`) ??
      document.getElementById('ev-title')
    )?.focus();
  }, [schedaDaRaggiungere, annunciaStatoLingua]);
  // Un campo di titolo o descrizione cambiato in una lingua la tocca.
  const aggiornaTesti = useCallback(
    (patch: Partial<WizardForm>) => {
      if (patch.title || patch.description) {
        const prima = formRef.current;
        const lingue = new Set([
          ...Object.keys(patch.title ?? {}),
          ...Object.keys(patch.description ?? {}),
        ]);
        tocca(
          [...lingue].filter(
            (l) =>
              (patch.title && (patch.title[l] ?? '') !== (prima.title[l] ?? '')) ||
              (patch.description &&
                (patch.description[l] ?? '') !== (prima.description[l] ?? ''))
          )
        );
      }
      updateForm(patch);
    },
    [tocca, updateForm]
  );
  // Togliere una lingua dall'evento: le lingue tolte con un testo lo perdono
  // al salvataggio (chi toglie ha confermato). Ogni lingua tolta e' toccata:
  // il server toglie testo e stato solo alle lingue tolte che il modulo dice
  // toccate, mai a quelle uscite dall'elenco senza una scelta di chi scrive.
  const cambiaLingueEvento = useCallback(
    (valore: string | null, tolte: string[]) => {
      const prima = formRef.current;
      const dopo = parseLocaleList(valore);
      const uscite = parseLocaleList(prima.aiTargetLocales).filter((l) => !dopo.includes(l));
      // Nessuna lingua e' una scelta: si salva '' (null vorrebbe dire «quelle
      // del sito»).
      if (tolte.length === 0) {
        tocca(uscite);
        updateForm({ aiTargetLocales: valore ?? '' });
        return;
      }
      const title = { ...prima.title };
      const description = { ...prima.description };
      for (const l of tolte) {
        title[l] = '';
        description[l] = '';
      }
      tocca([...new Set([...tolte, ...uscite])]);
      updateForm({ aiTargetLocales: valore ?? '', title, description });
    },
    [tocca, updateForm]
  );
  const lingueDelPasso = {
    riga: (
      <RigaLingue
        principale={props.defaultLocale}
        valore={form.aiTargetLocales}
        onCambia={cambiaLingueEvento}
        attive={props.enabledLocales}
        altreLingue={props.aiPipelineEnabled ?? true}
        conTesto={(l) => haTesto(l, form.title, form.description)}
        motore={motoreEvento}
        avvisoAmministrazione={!props.textTranslationAvailable && !!props.isSiteAdmin}
        invalid={!!fieldErrors.aiTargetLocales}
        annuncio={statoLingue.annuncio}
      />
    ),
    schede: statoLingue.schede,
    aspetto: aspettoSchede,
    pannello: (lingua: string) => (
      <PannelloLingua
        lingua={lingua}
        stato={statoLingue.stati[lingua] ?? 'principale'}
        principale={props.defaultLocale}
        motore={motoreEvento && lingueEvento.includes(lingua)}
        staff={viaToken === null}
        fallimento={statoLingue.fallimenti[lingua]}
        inviando={statoLingue.inviando === lingua}
        errore={statoLingue.errore}
        onRiletta={() => {
          tocca([lingua]);
          setSchedaDaRaggiungere(lingua);
        }}
        onRitraduci={() => {
          // Il testo di una persona se ne va: al salvataggio la lingua e'
          // vuota, e il server la traduce.
          tocca([lingua]);
          updateForm({
            title: { ...formRef.current.title, [lingua]: '' },
            description: { ...formRef.current.description, [lingua]: '' },
          });
          setSchedaDaRaggiungere(lingua);
        }}
        onRiprova={() => void statoLingue.riprova(lingua)}
      />
    ),
  };

  // ── Bozza nel browser ─────────────────────────────────────────────────────
  // Il modulo si salva nel browser (con un attimo di ritardo), cosi' un
  // ricaricamento o un clic sbagliato non lo perde: in modifica una bozza per
  // evento, in creazione una per formato o modello, che si offre tornando
  // sullo stesso. La bozza di creazione di una versione precedente (una sola
  // per tutti) si offre in ogni creazione, finche' la si riprende o la si
  // scarta. Il primo giro non salva (un modulo intatto non e' una bozza); un
  // invio riuscito toglie le bozze di creazione.
  const draftKey = initialEvent?.id
    ? `pa-wizard-draft:${initialEvent.id}`
    : `${BOZZA_NUOVO_KEY}:${props.template?.id ?? 'vuoto'}`;
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Uscendo (cambio di formato, salvataggio riuscito) la bozza non si
  // riscrive piu'.
  const usciteRef = useRef(false);
  const fermaAutosalvataggio = useCallback(() => {
    usciteRef.current = true;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
  }, []);
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey);
      if (mode === 'create') {
        // L'evento nuovo e' salvato: niente di cio' che lo riguardava resta
        // da riproporre (le bozze degli altri formati, quella della versione
        // precedente, i dati portati da «Cambia formato»).
        localStorage.removeItem(TRASLOCO_KEY);
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith(BOZZA_NUOVO_KEY)) localStorage.removeItem(k);
        }
      }
    } catch {
      /* storage unavailable */
    }
  }, [draftKey, mode]);

  // Arrivando da «Cambia formato»: cio' che si era scritto sull'evento torna
  // sopra i valori del formato nuovo, una volta sola, se recente; un avviso lo
  // dice e permette di ricominciare da capo.
  const [traslocoApplicato, setTraslocoApplicato] = useState(false);
  const traslocoRef = useRef(false);
  useEffect(() => {
    if (mode !== 'create') return;
    try {
      const raw = localStorage.getItem(TRASLOCO_KEY);
      if (!raw) return;
      localStorage.removeItem(TRASLOCO_KEY);
      const { at, dati } = JSON.parse(raw) as { at?: number; dati?: Partial<WizardForm> };
      if (!dati || typeof at !== 'number' || Date.now() - at > TRASLOCO_VALIDO_MS) return;
      traslocoRef.current = true;
      setForm((prima) => conDatiDellEvento(prima, dati));
      setTraslocoApplicato(true);
    } catch {
      /* corrupt or unavailable — ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipFirstAutosave = useRef(true);
  useEffect(() => {
    if (skipFirstAutosave.current) {
      skipFirstAutosave.current = false;
      return;
    }
    autosaveRef.current = setTimeout(() => {
      if (usciteRef.current) return;
      try {
        // Con le lingue toccate: riprendendo la bozza, solo quelle tornano
        // come le si era scritte (vedi restoreDraft).
        const bozza: BozzaDelModulo = { ...form, lingueToccate: [...toccate] };
        localStorage.setItem(draftKey, JSON.stringify(bozza));
      } catch {
        /* quota / unavailable — best effort */
      }
    }, 800);
    return () => {
      if (autosaveRef.current) clearTimeout(autosaveRef.current);
    };
  }, [form, draftKey, toccate]);

  const savedDraftRef = useRef<{ key: string; form: Partial<BozzaDelModulo> } | null>(null);
  const [draftAvailable, setDraftAvailable] = useState(false);
  useEffect(() => {
    // I dati appena portati da «Cambia formato» non si fanno coprire da una
    // bozza piu' vecchia.
    if (traslocoRef.current) return;
    try {
      const chiave = [draftKey, ...(mode === 'create' ? [BOZZA_NUOVO_KEY] : [])].find(
        (k) => localStorage.getItem(k) !== null
      );
      const raw = chiave ? localStorage.getItem(chiave) : null;
      if (chiave && raw) {
        savedDraftRef.current = {
          key: chiave,
          form: JSON.parse(raw) as Partial<BozzaDelModulo>,
        };
        setDraftAvailable(true);
      }
    } catch {
      /* ignore */
    }
    // Run once on mount for this draft key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDraft = useCallback(() => {
    const salvata = savedDraftRef.current;
    // Sopra il modulo di partenza, non al suo posto: una bozza salvata prima
    // che il modulo avesse un campo nuovo non lo lascerebbe vuoto.
    // Chi entra con un link di conduzione non cambia chi partecipa (lo
    // decide lo staff): una bozza che lo cambiava non lo riporta.
    // Un questionario che ha gia' risposte non si cambia da qui: la bozza non
    // ne riporta una versione modificata, che il salvataggio non scriverebbe.
    const risposte = initialEvent?.questionnaireResponses;
    // Le scelte della bozza sono di chi l'ha scritta: il programma dira'
    // solo quelle tolte ora, per una persona che nella bozza non c'e'.
    if (salvata && Array.isArray(salvata.form.agenda) && !initialEvent?.agendaLocked) {
      scelteVisteRef.current = new Map(salvata.form.agenda.map((v) => [v.key, v.speakerKey]));
    }
    // Le altre lingue tornano come le si era scritte solo se le si era
    // toccate: le altre restano quelle del server, che nel frattempo puo'
    // avere una traduzione piu' nuova di quella che la bozza ricorda. Una
    // bozza di prima, che non dice le lingue toccate, riporta le lingue che
    // cambia e che hanno un testo (mai una lingua svuotata).
    const { lingueToccate, ...datiBozza } = salvata?.form ?? {};
    const testiBozza = (prima: WizardForm) => {
      const titoli = (datiBozza.title ?? {}) as Record<string, string>;
      const descrizioni = (datiBozza.description ?? {}) as Record<string, string>;
      const lingue = [...new Set([...Object.keys(titoli), ...Object.keys(descrizioni)])].filter(
        (l) => l !== props.defaultLocale
      );
      const riprese = Array.isArray(lingueToccate)
        ? lingue.filter((l) => lingueToccate.includes(l))
        : lingue.filter(
            (l) =>
              haTesto(l, titoli, descrizioni) &&
              ((l in titoli && (titoli[l] ?? '') !== (prima.title[l] ?? '')) ||
                (l in descrizioni && (descrizioni[l] ?? '') !== (prima.description[l] ?? '')))
          );
      const title = { ...prima.title, [props.defaultLocale]: titoli[props.defaultLocale] ?? prima.title[props.defaultLocale] ?? '' };
      const description = {
        ...prima.description,
        [props.defaultLocale]:
          descrizioni[props.defaultLocale] ?? prima.description[props.defaultLocale] ?? '',
      };
      for (const l of riprese) {
        if (l in titoli) title[l] = titoli[l] ?? '';
        if (l in descrizioni) description[l] = descrizioni[l] ?? '';
      }
      return { title, description, riprese };
    };
    if (salvata) tocca(testiBozza(formRef.current).riprese);
    if (salvata)
      setForm((prima) => conSceltePulite({
        ...prima,
        ...datiBozza,
        // Una bozza di prima senza lingue (null) non toglie quelle del
        // modulo: per lei null era «nessuna traduzione», non una scelta, e
        // salvarla come '' toglierebbe all'evento ogni lingua e il loro testo.
        ...(datiBozza.aiTargetLocales == null ? { aiTargetLocales: prima.aiTargetLocales } : {}),
        ...(datiBozza.title || datiBozza.description
          ? { title: testiBozza(prima).title, description: testiBozza(prima).description }
          : {}),
        ...(viaToken !== null ? { accessMode: prima.accessMode } : {}),
        ...((risposte?.pre ?? 0) > 0 ? { preEventQuestionnaire: prima.preEventQuestionnaire } : {}),
        ...((risposte?.post ?? 0) > 0 ? { postEventQuestionnaire: prima.postEventQuestionnaire } : {}),
        // Un'agenda gia' usata in sala non si cambia da qui, come sopra; una
        // bozza di prima del programma non lo porta, e resta quello del modulo.
        ...(initialEvent?.agendaLocked || !Array.isArray(salvata.form.agenda)
          ? { agenda: prima.agenda }
          : {}),
      }));
    // La bozza della versione precedente, ripresa, vive ora sotto la chiave
    // di questo formato.
    try {
      if (salvata && salvata.key !== draftKey) localStorage.removeItem(salvata.key);
    } catch {
      /* ignore */
    }
    setDraftAvailable(false);
  }, [draftKey, viaToken, initialEvent, conSceltePulite, tocca, props.defaultLocale]);
  const dismissDraft = useCallback(() => {
    try {
      const salvata = savedDraftRef.current;
      if (salvata) localStorage.removeItem(salvata.key);
    } catch {
      /* ignore */
    }
    setDraftAvailable(false);
  }, []);

  // I passi nella barra (cinque, quattro per una chiamata istantanea, senza
  // il programma) e, a parte, le impostazioni avanzate (con la sezione
  // aperta). Avanti e Indietro percorrono i passi; dalle impostazioni
  // avanzate si torna al riepilogo.
  const passi = passiPrincipali(istantanea);
  const indicePasso = (passi as readonly StepKey[]).indexOf(activeStep);
  const vai = (step: StepKey, sez?: WizardAdvancedSection | null) => {
    if (caricamentiInViaggio > 0) return;
    if (step === 'advanced') apriSezione(sez ?? null);
    setActiveStep(step);
  };
  const goPrev = () => {
    if (activeStep === 'advanced') vai('review');
    else if (indicePasso > 0) vai(passi[indicePasso - 1]!);
    // Il programma di una chiamata istantanea (raggiunto da un errore) non e'
    // nella barra: si torna a «Persone».
    else if (indicePasso < 0) vai(passoDisponibile(activeStep, istantanea));
  };
  /** Al passo dopo (dalle impostazioni avanzate: al riepilogo), solo con il
   *  passo a posto. */
  const goNext = () => {
    if (caricamentiInViaggio > 0) return;
    const errs = validateStep(activeStep, form, props.defaultLocale, retentionMax);
    if (Object.keys(errs).length > 0) {
      chiaviClientRef.current = new Set(Object.keys(errs));
      fuocoRichiestoRef.current = true;
      // Il campo da correggere sta in una sezione ripiegata: la si apre.
      if (activeStep === 'advanced' && (errs.dataRetentionDays || errs.gdprTemplateId))
        apriSezione('data');
      setFieldErrors(errs);
      showError(t('validationFailed'));
      return;
    }
    setFieldErrors({});
    setSubmitError(null);
    if (activeStep === 'advanced' || indicePasso < 0) setActiveStep('review');
    else if (indicePasso < passi.length - 1)
      setActiveStep(passi[indicePasso + 1]!);
  };

  // L'anteprima della pagina segue il modulo un passo indietro: si scrive
  // senza aspettarla. Nella lingua dell'interfaccia, come la vedrebbe chi
  // visita il sito in quella lingua (con il ripiego della pagina),
  // e con tutte le etichette, anche quando il modulo non le fa cambiare.
  const linguaInterfaccia = useLocale();
  const moduloDifferito = useDeferredValue(form);
  const conAnteprima =
    !istantanea &&
    (activeStep === 'base' || activeStep === 'schedule' || activeStep === 'programme');
  const anteprima = useMemo(
    () =>
      conAnteprima
        ? datiAnteprima(moduloDifferito, {
            locale: linguaInterfaccia,
            tags: props.availableTags,
            startsAt: istanteDalModulo(moduloDifferito.startsAt, moduloDifferito.timezone),
            endsAt: istanteDalModulo(moduloDifferito.endsAt, moduloDifferito.timezone),
            parseTitleKicker: resolveKickerEnabled(moduloDifferito, props.siteDefaultParseTitleKicker),
            campiLiberi: props.campiLiberi,
          })
        : null,
    [
      conAnteprima,
      moduloDifferito,
      linguaInterfaccia,
      props.availableTags,
      props.siteDefaultParseTitleKicker,
      props.campiLiberi,
    ],
  );
  // Chi si iscrive davvero: la scelta dell'evento, o quella del sito. Una
  // chiamata istantanea non ha iscrizione: il link e' l'invito.
  const iscrizioneAperta = publicRegistrationFor(
    form,
    props.publicRegistrationEnabled ?? true
  );

  // Cio' che manca ancora: la barra lo dice per passo, il riepilogo per campo.
  const mancanti = useMemo(
    () => campiMancanti(form, props.defaultLocale, retentionMax, mode === 'create'),
    [form, props.defaultLocale, retentionMax, mode]
  );
  // Al campo che manca: si apre il suo passo e, appena e' sullo schermo, il
  // fuoco va su di lui.
  const campoDaRaggiungere = useRef<string | null>(null);
  const vaiAlCampo = useCallback(
    (m: CampoMancante) => {
      const id = idDelCampo(m.key, props.defaultLocale);
      if (m.step === 'advanced') apriSezione('data');
      if (m.step === activeStep) {
        // Gia' sul passo: il campo e' sullo schermo.
        const el = id ? document.getElementById(id) : null;
        const bersaglio =
          el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)
            ? el
            : el?.querySelector<HTMLElement>('input, textarea');
        bersaglio?.focus({ preventScroll: true });
        bersaglio?.scrollIntoView?.({ block: 'center' });
        return;
      }
      // Un altro passo smonterebbe il campo di un file in viaggio: si aspetta.
      if (caricamentiInViaggio > 0) return;
      campoDaRaggiungere.current = id;
      setActiveStep(m.step);
    },
    [props.defaultLocale, activeStep, caricamentiInViaggio]
  );
  useEffect(() => {
    const id = campoDaRaggiungere.current;
    if (!id) return;
    campoDaRaggiungere.current = null;
    const el = document.getElementById(id);
    const bersaglio =
      el && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName)
        ? el
        : el?.querySelector<HTMLElement>('input, textarea');
    bersaglio?.focus({ preventScroll: true });
    bersaglio?.scrollIntoView?.({ block: 'center' });
  }, [activeStep]);

  // Il cambio di modello: cio' che si e' scritto sull'evento (titolo,
  // descrizione, date, persone, contenuti) passa al modello nuovo, che porta
  // le sue impostazioni; la bozza del modello lasciato se ne va.
  const [cambiandoModello, setCambiandoModello] = useState(false);
  const cambiaModello = useCallback(() => {
    // La bozza in attesa di salvarsi non deve riscrivere quella appena tolta.
    fermaAutosalvataggio();
    try {
      const dati = datiCambiati(form, initial);
      if (Object.keys(dati).length > 0) {
        localStorage.setItem(TRASLOCO_KEY, JSON.stringify({ at: Date.now(), dati }));
      }
      // Cio' che si e' scritto passa con il formato: la bozza di questo e
      // quella della versione precedente non lo coprirebbero piu' tardi.
      localStorage.removeItem(draftKey);
      localStorage.removeItem(BOZZA_NUOVO_KEY);
    } catch {
      /* storage unavailable */
    }
    setCambiandoModello(true);
    // Chi partecipa torna fra le risposte del formato: le domande la mostrano
    // come la si vede ora, e il formato nuovo la riprende.
    props.onChangeTemplate?.({
      invitati: !publicRegistrationFor(form, props.publicRegistrationEnabled ?? true),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, form, initial, props.onChangeTemplate, props.publicRegistrationEnabled, fermaAutosalvataggio]);

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
    (
      err: { error?: string; message?: string; details?: unknown },
      status: number
    ): string => {
      if (!Array.isArray(err.details)) {
        return err.error ?? err.message ?? `HTTP ${status}`;
      }
      const mapped = mapServerIssues(err.details, props.defaultLocale);
      chiaviClientRef.current = new Set();
      fuocoRichiestoRef.current = true;
      setFieldErrors(mapped.fieldErrors);
      if (mapped.step === 'advanced') apriSezione('data');
      if (mapped.step) setActiveStep(mapped.step);
      const parti: string[] = [];
      if (mapped.step) parti.push(t('validationFailed'));
      if (mapped.unmapped.length > 0 || parti.length === 0) {
        parti.push(
          t('validationFailedDetail', {
            reason: mapped.unmapped.join('; ') || err.error || `HTTP ${status}`,
          })
        );
      }
      return parti.join('\n');
    },
    [props.defaultLocale, t]
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
      // Un file ancora in viaggio non e' nel modulo: si salverebbe senza.
      if (caricamentiInViaggio > 0) return;
      setAzione(submitMode);
      // Validate every step before submitting (especially on publish).
      const aggregated: Record<string, string> = {};
      for (const key of STEP_KEYS) {
        Object.assign(
          aggregated,
          validateStep(key, form, props.defaultLocale, retentionMax)
        );
      }
      if (submitMode === 'publish') {
        Object.assign(aggregated, validatePublish(form));
      }
      if (Object.keys(aggregated).length > 0) {
        chiaviClientRef.current = new Set(Object.keys(aggregated));
        fuocoRichiestoRef.current = true;
        setFieldErrors(aggregated);
        showError(t('validationFailed'));
        // Al primo passo con un errore. Gli errori di validatePublish
        // (moderatorName/moderatorEmail) non sono coperti da validateStep e
        // i campi stanno nel passo «Persone»: se falliscono, contano come
        // suoi (altrimenti il messaggio resta senza campo evidenziato).
        const firstFailing = STEP_KEYS.find(
          (k) =>
            Object.keys(validateStep(k, form, props.defaultLocale, retentionMax)).length >
              0 ||
            (k === 'invites' && !!(aggregated.moderatorName || aggregated.moderatorEmail))
        );
        if (firstFailing) {
          if (firstFailing === 'advanced') apriSezione('data');
          setActiveStep(firstFailing);
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

        const startsAtUTC = fromDatetimeLocalInTz(
          form.startsAt,
          form.timezone
        ).toISOString();
        const endsAtUTC = fromDatetimeLocalInTz(form.endsAt, form.timezone).toISOString();

        const mandate = [...toccate].sort();
        // Il testo mandato delle lingue toccate: dopo il salvataggio restano
        // toccate solo quelle cambiate di nuovo mentre la richiesta viaggiava.
        const testiMandati = { title: { ...form.title }, description: { ...form.description } };
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
          tagSlugs: viaToken !== null ? undefined : form.tagSlugs,
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
          liveCaptionsEnabled: form.liveCaptionsEnabled,
          // Senza sottotitoli non c'e' niente da trascrivere.
          captionsTranscriptEnabled: form.liveCaptionsEnabled && form.captionsTranscriptEnabled,
          autoStartRecording: form.recordingEnabled && form.autoStartRecording,

          // Postprod AI — subordinate al recording (server-side resta
          // un'invariante: senza recordingEnabled non c'è transcript).
          aiTranscriptEnabled: form.recordingEnabled && form.aiTranscriptEnabled,
          aiSummaryEnabled:
            form.recordingEnabled && form.aiTranscriptEnabled && form.aiSummaryEnabled,
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
          // Le lingue dell'evento: le schede, la traduzione automatica al
          // salvataggio e (se accesa) quella di sottotitoli e sintesi. Sempre
          // esplicite ('' e' «nessuna»): null vorrebbe dire «quelle del sito».
          // Il modulo le ha sempre, anche dopo una bozza di prima (restoreDraft).
          aiTargetLocales: form.aiTargetLocales ?? '',
          // Le lingue toccate qui: delle altre il server tiene il testo che
          // ha, anche una traduzione arrivata a pagina aperta.
          textEdits: { touched: mandate },
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
            mode === 'edit' &&
            form.postEventPublic === initialEvent?.event.postEventPublic
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
          privacyPolicyUrl: form.privacyPolicyUrl || (mode === 'edit' ? null : undefined),
          moderatorName: form.moderatorName?.trim() || undefined,
          moderatorEmail: form.moderatorEmail?.trim() || undefined,
          moderatorOrganization: form.moderatorOrganization?.trim() || null,
          moderatorOrganizationLogoUrl: form.moderatorOrganizationLogoUrl?.trim() || null,
          moderatorPublicListed: !!form.moderatorPublicListed,
          moderatorPhotoId: form.moderatorPhotoId ?? null,
          // In modifica solo se cambiato: un evento che segue il sito (null)
          // continua a seguirlo finche' qui non si sceglie.
          // Con un link di conduzione non si manda mai: lo decide lo staff.
          accessMode:
            viaToken !== null ||
            (mode === 'edit' && form.accessMode === initialEvent?.event.accessMode)
              ? undefined
              : form.accessMode,
          requireOrganization: form.requireOrganization,
          requireOrganizationRole: form.requireOrganizationRole,
          requireOrganizationType: form.requireOrganizationType,
        };

        // ── Edit mode: PUT the event, diff-based fan-out, then redirect
        //    back to the event detail page. Everything below the `return`
        //    is the "create" branch.
        if (mode === 'edit' && initialEvent) {
          const eventId = initialEvent.id;
          const moderatorToken = initialEvent.moderatorToken;

          // Il token solo nell'intestazione: nell'indirizzo finirebbe nei log.
          const putRes = await fetch(`/api/events/${eventId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${moderatorToken}`,
            },
            body: JSON.stringify(payload),
          });
          if (!putRes.ok) {
            const err = await putRes.json().catch(() => ({}));
            throw new Error(serverErrorMessage(err, putRes.status));
          }
          // Il testo salvato e' ora quello del modulo: le lingue mandate non
          // sono piu' «toccate» (il server ha il loro testo, e una traduzione
          // che arriva ora le puo' riempire), e lo stato si rilegge. Solo lo
          // staff rilegge: con il link di conduzione restano com'erano, e la
          // pagina dice lo stato di prima del salvataggio.
          if (viaToken === null) {
            setPrincipaleSalvato(
              testoPrincipale(props.defaultLocale, testiMandati.title, testiMandati.description)
            );
            setToccate((ora) => {
              const adesso = formRef.current;
              const resta = [...ora].filter(
                (l) =>
                  !mandate.includes(l) ||
                  (adesso.title[l] ?? '') !== (testiMandati.title[l] ?? '') ||
                  (adesso.description[l] ?? '') !== (testiMandati.description[l] ?? '')
              );
              return resta.length === ora.size ? ora : new Set(resta);
            });
            scartaLetture();
            void ricaricaLingue();
          }

          const report = await fanoutEditDiff(
            eventId,
            moderatorToken,
            form,
            snapshotRef.current ?? initialEvent,
            props.defaultLocale
          );
          setRisposteQuestionari((snapshotRef.current ?? initialEvent).questionnaireResponses);
          // Gli argomenti nuovi del programma hanno ora un id: un altro
          // salvataggio li aggiorna invece di ricrearli.
          const agendaSalvata = (snapshotRef.current ?? initialEvent).agenda;
          if (agendaSalvata) {
            setForm((prima) => ({ ...prima, agenda: conIdSalvati(prima.agenda ?? [], agendaSalvata) }));
          }

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
            t('revocationFailed', { name, tab: tDetail('tabs.people') })
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
                : t('partialFailureEdit', { items: risorse })
            );
          }
          if (avvisi.length > 0) {
            throw new Error(avvisi.join('\n'));
          }

          fermaAutosalvataggio();
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

        // 3) Organizzatori, moderatori e relatori (EventModerator). La
        //    concessione creata serve al programma: chi interviene si indica
        //    con la persona, che solo ora ha un id.
        const concessioni: Array<{ id: string; email: string | null }> = [];
        const persone = [
          ...form.moderators.map((m) => ({ ...m, role: 'MODERATOR' as const })),
          ...form.speakers.map((sp) => ({ ...sp, organizer: false, role: 'SPEAKER' as const })),
        ];
        for (const p of persone) {
          const creata = await fetch(`/api/events/${created.id}/moderators`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({
              name: p.name,
              email: p.email,
              role: p.role,
              ...profiloSalvato(p),
            }),
          })
            .then(async (r) =>
              r.ok ? { id: ((await r.json().catch(() => null)) as { id?: string } | null)?.id } : null,
            )
            .catch(() => null);
          if (!creata) failed.add(p.role === 'MODERATOR' ? 'moderators' : 'speakers');
          else if (creata.id) concessioni.push({ id: creata.id, email: p.email });
        }

        // 4) Il programma, se l'agenda e' accesa: gli argomenti con chi
        //    interviene, in una richiesta.
        const piano = form.agendaEnabled
          ? pianoDaInviare(form.agenda ?? [], (chiave) => concessioneDaChiave(chiave, concessioni))
          : [];
        if (piano.length > 0) {
          const ok = await fetch(`/api/events/${created.id}/agenda`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(moderatorToken ? { Authorization: `Bearer ${moderatorToken}` } : {}),
            },
            body: JSON.stringify({ base: [], plan: piano }),
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!ok) failed.add('agenda');
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
          props.defaultLocale
        );
        await submitQuestionnaire(
          reportQ,
          created.id,
          'POST_EVENT',
          form.postEventQuestionnaire,
          props.defaultLocale
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
            publishProblem = {
              reason: err.error ?? err.message ?? `HTTP ${pubRes.status}`,
            };
          }
        }

        // Le risorse non salvate e una pubblicazione fallita: sulla pagina di
        // gestione le dice il riepilogo dell'evento appena creato, che resta
        // finche' non lo si chiude. Verso un'altra pagina, o se il browser non
        // conserva l'esito, un avviso, che sopravvive al cambio di pagina.
        const esitoConservato =
          !overrideRedirect &&
          rememberCreation(created.id, {
            unsaved: [...failed],
            publishFailed: publishProblem !== null,
          });
        if (failed.size > 0 && !esitoConservato) {
          toast.error(
            t('partialFailure', {
              items: [...failed].map((k) => t(`resources.${k}`)).join(', '),
            })
          );
        }
        if (publishProblem) {
          toast.error(
            publishProblem.reason
              ? t('publishFailedDetail', { reason: publishProblem.reason })
              : t('publishFailed')
          );
        }

        fermaAutosalvataggio();
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
      fermaAutosalvataggio,
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
      toccate,
      ricaricaLingue,
      scartaLetture,
      caricamentiInViaggio,
    ]
  );

  const saveDraftAndNavigate = useCallback(
    async (destination: string) => {
      await handleSubmit('draft', destination);
    },
    [handleSubmit]
  );

  // L'organizzatore principale, come lo leggono il suo riquadro e l'elenco
  // delle persone (per non aggiungerlo una seconda volta).
  const primario = useMemo(
    () => ({
      name: form.moderatorName ?? '',
      email: form.moderatorEmail ?? '',
      organization: form.moderatorOrganization ?? null,
      organizationLogoUrl: form.moderatorOrganizationLogoUrl ?? null,
      publicListed: !!form.moderatorPublicListed,
      photoId: form.moderatorPhotoId ?? null,
    }),
    [
      form.moderatorName,
      form.moderatorEmail,
      form.moderatorOrganization,
      form.moderatorOrganizationLogoUrl,
      form.moderatorPublicListed,
      form.moderatorPhotoId,
    ]
  );

  return (
    <LibreriaDomandeProvider value={libreriaDomande}>
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

      {/* I dati portati da «Cambia formato»: lo si dice, e si puo' ripartire
          dai soli valori del formato. */}
      {traslocoApplicato && (
        <div
          className="alert alert-info d-flex flex-wrap align-items-center justify-content-between gap-2"
          role="status"
        >
          <span>{t('flow.carriedOver')}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              setForm(initial);
              setTraslocoApplicato(false);
            }}
          >
            {t('flow.startOver')}
          </button>
        </div>
      )}

      {/* Il modello in uso, e il modo di cambiarlo: i default vengono da lui. */}
      {mode === 'create' && props.onChangeTemplate && (
        <div className="wizard-modello d-flex flex-wrap align-items-center gap-2 mb-3">
          <span>
            {props.formatoLabel
              ? t.rich('flow.formatInUse', {
                  name: props.formatoLabel,
                  b: (c) => <strong>{c}</strong>,
                })
              : props.template
                ? t.rich('flow.templateInUse', {
                    name: props.template.name,
                    b: (c) => <strong>{c}</strong>,
                  })
                : t('flow.noTemplate')}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            onClick={cambiaModello}
            // Un file in viaggio non arriverebbe nel formato nuovo.
            disabled={cambiandoModello || caricamentiInViaggio > 0}
          >
            {props.formatoLabel
              ? t('flow.changeFormat')
              : props.template
                ? t('flow.changeTemplate')
                : t('flow.chooseTemplate')}
          </button>
        </div>
      )}

      <StepNav
        steps={passi.map((k) => ({
          key: k,
          label: t(`flow.steps.${k}`),
          daCompletare: mancanti.some((m) => m.step === k),
        }))}
        advanced={{
          label: t('flow.steps.advanced'),
          daCompletare: mancanti.some((m) => m.step === 'advanced'),
        }}
        activeStep={activeStep}
        onJump={(k) => vai(k)}
        ariaLabel={t('stepsAriaLabel')}
        daCompletareLabel={t('flow.toComplete')}
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
        className="mt-4 wizard-contenuto"
        ref={contentRef}
        tabIndex={-1}
        role="group"
        aria-label={t(`flow.steps.${activeStep}`)}
        style={{ outline: 'none' }}
      >
        {activeStep === 'advanced' && (
          <button
            type="button"
            className="btn btn-link p-0 mb-3 wizard-torna"
            onClick={goNext}
          >
            ← {t('flow.backToReview')}
          </button>
        )}
        {(activeStep === 'base' || activeStep === 'schedule') && (
          // Accanto al modulo, come apparira' la pagina dell'evento (non per
          // le chiamate rapide, che una pagina pubblica non l'hanno).
          <div className={istantanea ? undefined : 'wizard-con-anteprima'}>
            <div className="wizard-con-anteprima__modulo">
              <Step1Base
                parte={activeStep === 'base' ? 'evento' : 'quando'}
                dopoDescrizione={
                  istantanea ? undefined : (
                    <ProgrammeCard
                      value={form}
                      descrizione={form.description[props.defaultLocale] ?? ''}
                      onVai={() => vai('programme')}
                    />
                  )
                }
                onEtichettaCreata={
                  viaToken === null && props.canManageTags
                    ? (nuova) => setEtichetteCreate((prima) => [...prima, nuova])
                    : undefined
                }
                value={form}
                onChange={aggiornaTesti}
                enabledLocales={props.enabledLocales}
                defaultLocale={props.defaultLocale}
                availableTags={etichette}
                fieldErrors={fieldErrors}
                siteDefaultParseTitleKicker={props.siteDefaultParseTitleKicker}
                siteDefaultVideoQuality={props.siteDefaultVideoQuality}
                lingue={activeStep === 'base' ? lingueDelPasso : undefined}
                onUploadBusy={segnalaCaricamento}
              />
            </div>
            {anteprima && <PagePreview dati={anteprima} />}
          </div>
        )}
        {activeStep === 'invites' && (
          <RubricaAccessContext.Provider value={props.canUseRubrica ?? false}>
            <StepPeople
              value={form}
              onChange={updateForm}
              invitationsLocked={viaToken !== null}
              // Le foto si caricano con la sessione dello staff.
              photosLocked={viaToken !== null}
              onUploadBusy={segnalaCaricamento}
              primary={primario}
              publicRegistrationEnabled={iscrizioneAperta}
              // Il programma si pubblica nella pagina dell'evento: una
              // chiamata istantanea non ne ha una, ne' il passo che lo prepara.
              rimandoProgramma={!istantanea}
              iscrizione={
                istantanea ? undefined : (
                  <SezioneIscrizione
                    accessMode={form.accessMode}
                    requireOrganization={form.requireOrganization}
                    requireOrganizationRole={form.requireOrganizationRole}
                    requireOrganizationType={form.requireOrganizationType}
                    onChange={updateForm}
                    siteOpen={props.publicRegistrationEnabled ?? true}
                    invitati={form.invitations.length}
                    bloccato={viaToken !== null}
                  iniziale={initial.accessMode}
                    questionari={
                      // I questionari li gestisce lo staff: chi entra con il
                      // link di conduzione non li vede qui.
                      viaToken === null ? (
                        <RiepilogoQuestionari
                          pre={form.preEventQuestionnaire}
                          post={form.postEventQuestionnaire}
                          feedbackPredefinito={mode === 'create'}
                          onModifica={() => vai('advanced', 'content')}
                        />
                      ) : undefined
                    }
                  />
                )
              }
            >
              <PrimarySection
                primary={primario}
                onPrimaryChange={updateForm}
                fieldErrors={fieldErrors}
                prefilledModeratorEmail={
                  mode === 'edit' ? null : (props.defaultModerator?.email ?? null)
                }
                showLinksOnPublish={
                  mode === 'create' || initialEvent?.event.status === 'DRAFT'
                }
                perPubblicare={mode === 'create'}
                photosLocked={viaToken !== null}
                onUploadBusy={segnalaCaricamento}
              />
            </StepPeople>
          </RubricaAccessContext.Provider>
        )}
        {activeStep === 'programme' && (
          // Accanto, la pagina dell'evento con il programma in primo piano.
          // Una chiamata istantanea non ha il passo nella barra: ci arriva
          // solo un errore da correggere, che deve potersi vedere.
          <div className={istantanea ? undefined : 'wizard-con-anteprima'}>
            <div className="wizard-con-anteprima__modulo">
              <StepProgramma
                value={form}
                onChange={updateForm}
                locked={agendaBloccata}
                fieldErrors={fieldErrors}
                tolte={righeSenzaRelatore}
                onVaiPersone={() => vai('invites')}
                creazione={mode === 'create'}
              />
            </div>
            {anteprima && <PagePreview dati={anteprima} fuoco="programma" />}
          </div>
        )}
        {activeStep === 'review' && (
          <Step5Review
            form={form}
            onChange={updateForm}
            defaultLocale={props.defaultLocale}
            gdprTemplates={props.gdprTemplates}
            fieldErrors={fieldErrors}
            onCustomize={(sez) => vai('advanced', sez ?? null)}
            onVaiAlCampo={vaiAlCampo}
            mancanti={mancanti}
            aiPipelineEnabled={props.aiPipelineEnabled ?? true}
            liveCaptionsAvailable={props.liveCaptionsAvailable ?? false}
            iscrizioneAperta={istantanea ? undefined : iscrizioneAperta}
            onVaiPersone={() => vai('invites')}
            onVaiProgramma={istantanea ? undefined : () => vai('programme')}
            programmaInCreazione={mode === 'create'}
            questionari={
              viaToken === null ? (
                <RigheQuestionari
                  pre={form.preEventQuestionnaire}
                  post={form.postEventQuestionnaire}
                  feedbackPredefinito={mode === 'create'}
                />
              ) : undefined
            }
            sopratitolo={form.parseTitleKicker ?? props.siteDefaultParseTitleKicker}
            capacita={riepilogoCapacita(form, props.capacita)}
          />
        )}
        {activeStep === 'advanced' && (
          <AdvancedSettings
            open={sezione}
            richiesta={richiestaSezione}
            templateName={
              mode === 'create' && !props.formatoLabel
                ? (props.template?.name ?? null)
                : null
            }
            sections={{
              participation: (
                <StepPermissions
                  parte="partecipazione"
                  programma={
                    istantanea
                      ? undefined
                      : {
                          argomenti: (form.agenda ?? []).filter(haTitolo).length,
                          onVai: () => vai('programme'),
                        }
                  }
                  value={form}
                  onChange={updateForm}
                  fieldErrors={fieldErrors}
                  whiteboardInfraReady={props.whiteboardInfraReady}
                  liveCaptionsAvailable={props.liveCaptionsAvailable ?? false}
                  aiPipelineEnabled={props.aiPipelineEnabled ?? true}
                  editing={mode === 'edit'}
                />
              ),
              recording: (
                <StepPermissions
                  parte="registrazione"
                  value={form}
                  onChange={updateForm}
                  fieldErrors={fieldErrors}
                  whiteboardInfraReady={props.whiteboardInfraReady}
                  aiPipelineEnabled={props.aiPipelineEnabled ?? true}
                  onCambiaLingue={() =>
                    vaiAlCampo({ key: 'aiTargetLocales', step: 'base', perPubblicare: false })
                  }
                  editing={mode === 'edit'}
                  showAutoStart={
                    mode === 'edit' && !!initialEvent?.event.autoStartRecording
                  }
                />
              ),
              content: (
                <Step4Content
                  incorporato
                  value={form}
                  onChange={updateForm}
                  onSaveDraftAndNavigate={
                    mode === 'create' ? saveDraftAndNavigate : undefined
                  }
                  submitting={submitting}
                  staffLocked={viaToken !== null}
                  defaultFeedbackHint={mode === 'create'}
                  responseCounts={risposteQuestionari}
                  eventId={initialEvent?.id}
                  onUploadBusy={segnalaCaricamento}
                />
              ),
              room: (
                <Step1Base
                  parte="avanzate"
                  value={form}
                  onChange={updateForm}
                  enabledLocales={props.enabledLocales}
                  defaultLocale={props.defaultLocale}
                  availableTags={etichette}
                  fieldErrors={fieldErrors}
                  siteDefaultParseTitleKicker={props.siteDefaultParseTitleKicker}
                  siteDefaultVideoQuality={props.siteDefaultVideoQuality}
                  onUploadBusy={segnalaCaricamento}
                />
              ),
              data: (
                <SezioneDati
                  form={form}
                  onChange={updateForm}
                  gdprTemplates={props.gdprTemplates}
                  fieldErrors={fieldErrors}
                  retentionMax={retentionMax}
                  onUploadBusy={segnalaCaricamento}
                />
              ),
              technical: (
                <SezioneTecnica
                  form={form}
                  onChange={updateForm}
                  capacita={props.capacita}
                  onCambiaPartecipanti={() =>
                    vaiAlCampo({ key: 'maxParticipants', step: 'schedule', perPubblicare: false })
                  }
                  onCambiaQualita={() => apriSezione('room')}
                />
              ),
            }}
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

      {/* Le azioni del passo restano a portata: la barra si ferma in fondo
          allo schermo mentre si scorre, con Indietro accanto ad Avanti. */}
      <div className="wizard-azioni">
        <div className="wizard-azioni__pulsanti">
        {/* Dalle impostazioni avanzate si torna al riepilogo con il pulsante
            a destra (e con il collegamento in cima): uno solo, non due. Al
            primo passo non c'e' niente prima. */}
        {activeStep !== 'advanced' && activeStep !== 'base' && (
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={goPrev}
            disabled={fermo}
          >
            ← {tc('back')}
          </button>
        )}

        {activeStep !== 'review' ? (
          <>
            {/* In modifica si salva da qualunque passo: cambiare
                un'impostazione non obbliga a percorrere tutto il wizard. */}
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => handleSubmit('draft')}
                disabled={fermo}
              >
                {submitting && azione === 'draft' ? tc('saving') : t('updateEvent')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={fermo}
            >
              {activeStep === 'advanced' ? t('flow.backToReview') : `${tc('next')} →`}
            </button>
          </>
        ) : mode === 'edit' ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSubmit('draft')}
            disabled={fermo}
          >
            {submitting && azione === 'draft' ? tc('saving') : t('updateEvent')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => handleSubmit('draft')}
              disabled={fermo}
            >
              {submitting && azione === 'draft' ? tc('saving') : t('saveDraft')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSubmit('publish')}
              disabled={fermo}
            >
              {submitting && azione === 'publish' ? tc('saving') : t('publish')}
            </button>
          </>
        )}
        </div>
      </div>
    </div>
    </LibreriaDomandeProvider>
  );
}

// ── Step navigation bar ─────────────────────────────────────────────────────
//
// I passi numerati e, a parte, le impostazioni avanzate. Ogni passo
// si apre con un clic (lo stato e' uno solo, non si perde niente); un passo
// con un campo obbligatorio vuoto lo dice sotto il nome.

/** I campi che parlano dell'evento, e non dipendono dal formato o dal
 *  modello: titolo e descrizione, date, persone, contenuti. */
const CAMPI_DELL_EVENTO = [
  'title',
  'description',
  'coverImageUrl',
  'imageUrl',
  'tagSlugs',
  'startsAt',
  'endsAt',
  'timezone',
  'recurrencePreset',
  'recurrenceRule',
  'recurrenceUntil',
  'recurrenceCount',
  'moderatorName',
  'moderatorEmail',
  'moderatorOrganization',
  'moderatorOrganizationLogoUrl',
  'moderatorPublicListed',
  'moderatorPhotoId',
  'parseTitleKicker',
  'requireOrganization',
  'requireOrganizationRole',
  'requireOrganizationType',
  'organizers',
  'moderators',
  'speakers',
  'invitations',
  'agenda',
  'materials',
  'preEventQuestionnaire',
  'postEventQuestionnaire',
] as const satisfies readonly (keyof WizardForm)[];

/** Cio' che si e' scritto sull'evento: solo i campi cambiati rispetto ai
 *  valori di partenza. La descrizione proposta da un modello, o le date di
 *  partenza, non sono scelte di chi crea l'evento e non si portano altrove. */
function datiCambiati(f: WizardForm, partenza: WizardForm): Partial<WizardForm> {
  const out: Partial<WizardForm> = {};
  for (const k of CAMPI_DELL_EVENTO) {
    if (JSON.stringify(f[k]) !== JSON.stringify(partenza[k])) {
      (out as Record<string, unknown>)[k] = f[k];
    }
  }
  // Un programma preparato e acceso e' dell'evento: con un formato che ha
  // l'agenda spenta non diventerebbe di sola lettura, ne' si perderebbe.
  if (out.agenda && f.agendaEnabled) out.agendaEnabled = true;
  return out;
}

/** Il modulo con i dati dell'evento portati da altrove. Se arriva l'inizio
 *  senza la fine, la fine la decide la durata di questo formato, nel fuso
 *  dell'evento. */
function conDatiDellEvento(modulo: WizardForm, dati: Partial<WizardForm>): WizardForm {
  const nuovo = { ...modulo, ...dati } as WizardForm;
  if (dati.startsAt && !dati.endsAt) {
    try {
      const durata =
        fromDatetimeLocalInTz(modulo.endsAt, modulo.timezone).getTime() -
        fromDatetimeLocalInTz(modulo.startsAt, modulo.timezone).getTime();
      const inizio = fromDatetimeLocalInTz(nuovo.startsAt, nuovo.timezone).getTime();
      if (Number.isFinite(durata) && durata > 0 && Number.isFinite(inizio)) {
        nuovo.endsAt = toDatetimeLocalInTz(new Date(inizio + durata), nuovo.timezone);
      }
    } catch {
      /* data incompleta: la fine resta quella del formato */
    }
  }
  return nuovo;
}

/** L'elemento di un campo che manca, per portarci il fuoco. */
function idDelCampo(key: string, defaultLocale: string): string | null {
  const campo = key.split('.')[0];
  // La durata di un argomento del programma: il campo della sua riga.
  if (campo === 'agenda') {
    const riga = Number(key.split('.')[1]);
    return Number.isInteger(riga) ? `wiz-programma-${riga}-min` : null;
  }
  switch (campo) {
    case 'title':
      return 'ev-title';
    case 'description':
      return `ev-description-${defaultLocale}`;
    case 'startsAt':
      return 'ev-starts';
    case 'endsAt':
      return 'ev-ends';
    case 'maxParticipants':
      return 'ev-max';
    case 'moderatorName':
      return 'wiz-primary-name';
    case 'moderatorEmail':
      return 'wiz-primary-email';
    case 'aiTargetLocales':
      // «Cambia lingue», nel passo «Evento».
      return 'ev-lingue-cambia';
    case 'dataRetentionDays':
      return 'rev-retention';
    default:
      return null;
  }
}

function StepNav({
  steps,
  advanced,
  activeStep,
  onJump,
  ariaLabel,
  daCompletareLabel,
}: {
  steps: Array<{ key: StepKey; label: string; daCompletare: boolean }>;
  advanced: { label: string; daCompletare: boolean };
  activeStep: StepKey;
  onJump: (k: StepKey) => void;
  ariaLabel: string;
  daCompletareLabel: string;
}) {
  const activeIdx = steps.findIndex((s) => s.key === activeStep);
  return (
    <nav aria-label={ariaLabel} className="mb-3 wizard-passi">
      <ol className="d-flex align-items-start justify-content-between list-unstyled mb-0 flex-wrap gap-2">
        {steps.map((s, i) => {
          const isActive = i === activeIdx;
          // Fatto: un passo prima di quello aperto, senza niente da
          // completare; dalle impostazioni avanzate, ogni passo da compilare
          // che non chiede piu' niente.
          const isDone =
            !s.daCompletare && (activeIdx >= 0 ? i < activeIdx : s.key !== 'review');
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
                <span className="d-flex flex-column text-start">
                  <span
                    className={isActive ? 'fw-bold' : ''}
                    style={{
                      color: isActive ? '#0066CC' : 'var(--app-text)',
                      fontSize: '0.9rem',
                    }}
                  >
                    {s.label}
                  </span>
                  {s.daCompletare && (
                    <span className="wizard-passi__da-fare">{daCompletareLabel}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {/* Le impostazioni avanzate: non un passo da percorrere, le scelte del
            modello raccolte in un posto. */}
        <li className="wizard-passi__avanzate">
          <button
            type="button"
            onClick={() => onJump('advanced')}
            aria-current={activeStep === 'advanced' ? 'step' : undefined}
            className={`btn btn-sm ${activeStep === 'advanced' ? 'btn-primary' : 'btn-outline-primary'} d-inline-flex align-items-center gap-2`}
          >
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            {advanced.label}
            {advanced.daCompletare && (
              <span className="wizard-passi__da-fare">· {daCompletareLabel}</span>
            )}
          </button>
        </li>
      </ol>
    </nav>
  );
}
