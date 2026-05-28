import { z } from 'zod';

// ── Event Schemas ────────────────────────────────────

const localizedStringField = z.record(z.string(), z.string());

const eventBaseSchema = z.object({
  title: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 3,
    { message: 'title.it is required and must be at least 3 characters' },
  ),
  description: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 10,
    { message: 'description.it is required and must be at least 10 characters' },
  ),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().refine(
    (tz) => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } },
    { message: 'Invalid IANA timezone' },
  ).default('Europe/Rome'),
  // Now an estimate of expected attendees, not a hard cap. Registrations
  // are not refused when this count is reached — the infra scales. The
  // validation max is a sanity bound only (prevents a fat-finger typo
  // triggering worst-case resource estimates).
  maxParticipants: z.number().int().min(2).max(10000).default(300),
  qaEnabled: z.boolean().default(true),
  chatEnabled: z.boolean().default(false),
  recordingEnabled: z.boolean().default(false),
  autoStartRecording: z.boolean().default(false),
  participantsCanUnmute: z.boolean().default(false),
  participantsCanStartVideo: z.boolean().default(false),
  participantsCanShareScreen: z.boolean().default(false),
  requireOrganization: z.boolean().default(false),
  requireOrganizationRole: z.boolean().default(false),
  requireOrganizationType: z.boolean().default(false),
  dataRetentionDays: z.number().int().min(1).max(365).default(30),
  privacyPolicyUrl: z.string().url().optional(),
  privacyPolicyText: z.string().max(10000).optional(),
  gdprTemplateId: z.string().uuid().nullable().optional(),
  /** Cleartext join password. Server hashes and stores in `join_password_hash`.
   *  Empty string clears the password (sets the column back to NULL). */
  joinPassword: z.string().max(200).optional(),
  youtubeUrl: z
    .string()
    .url()
    .refine(
      (u) => /(?:youtube\.com|youtu\.be)/i.test(u),
      { message: 'URL must point to youtube.com or youtu.be' },
    )
    .nullable()
    .optional(),
  libraryListed: z.boolean().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  moderatorName: z.string().min(2).max(100).optional(),
  moderatorEmail: z.string().email().optional(),
  speakersInfo: localizedStringField.optional(),
  organizerName: z.string().max(200).optional(),
  imageUrl: z.string().url().optional(),
  waitingRoomAudioUrl: z.string().url().optional(),
  // Percent 0-100, null → inherit SiteSetting.defaultSenderRatioPct.
  expectedSenderRatioPct: z.number().int().min(0).max(100).nullable().optional(),
  // Minutes of grace after endsAt. -1 never auto-closes, null inherits.
  gracePeriodMinutes: z.number().int().min(-1).max(240).nullable().optional(),
  postEventPublic: z.boolean().default(true),
  postEventPublicUntil: z.string().datetime().nullable().optional(),
  postEventShowQA: z.boolean().default(true),
  postEventShowMaterials: z.boolean().default(true),
  postEventShowPolls: z.boolean().default(true),
  postEventShowFeedback: z.boolean().default(true),
  feedbackEnabled: z.boolean().default(true),
  recordingConsentText: z.string().max(5000).optional(),

  // Recurrence (RFC 5545 RRULE). Null = one-off.
  recurrenceRule: z.string().max(500).nullable().optional(),
  recurrenceSeriesId: z.string().uuid().nullable().optional(),

  // Per-feature role allowlist. See `lib/utils/permission-matrix.ts`.
  // Accepting `any` here because Zod's record typings don't easily
  // express the role-enum shape; the server coerces via `coerceMatrix`
  // before persisting, which drops unknown keys.
  permissionMatrix: z.record(z.string(), z.array(z.string())).nullable().optional(),

  // Tag slugs (not UUIDs) so the admin can reference stable identifiers
  // between templates and events.
  tagSlugs: z.array(z.string().min(1).max(100)).max(30).optional(),

  // Per-event override for the editorial "title with kicker" convention.
  // Null (or omitted) inherits SiteSetting.parseTitleKicker; true/false
  // force on/off for this event only.
  parseTitleKicker: z.boolean().nullable().optional(),

  // ── AI postprod opt-ins (per-event). Master gate is the global
  //    SiteSetting.aiPipelineEnabled; these toggles let an organizer
  //    decide cosa generare per il singolo evento. Vedi schema.prisma
  //    `Event.aiTranscriptEnabled` ecc.
  aiTranscriptEnabled: z.boolean().optional(),
  aiSummaryEnabled: z.boolean().optional(),
  aiTranslationEnabled: z.boolean().optional(),
  aiDubbingEnabled: z.boolean().optional(),
  // Comma-separated ISO-639-1, null = inherit SiteSetting.aiDefaultTargetLocales.
  aiTargetLocales: z.string().max(200).nullable().optional(),
});

export const createEventSchema = eventBaseSchema.refine(
  (data) => new Date(data.endsAt) > new Date(data.startsAt),
  { message: 'endsAt must be after startsAt', path: ['endsAt'] },
);

export const updateEventSchema = eventBaseSchema.partial().extend({
  status: z
    .enum(['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED'])
    .optional(),
  recordingPublished: z.boolean().optional(),
  recordingDeleteAfterDays: z.number().int().min(1).max(365).nullable().optional(),
  recordingUrl: z.string().url().nullable().optional(),
  tempRecordingUrl: z.string().url().nullable().optional(),
  recordingFileSize: z.number().int().nullable().optional(),
  recordingDuration: z.number().int().nullable().optional(),
}).refine(
  (data) => {
    if (data.startsAt && data.endsAt) {
      return new Date(data.endsAt) > new Date(data.startsAt);
    }
    return true;
  },
  { message: 'endsAt must be after startsAt', path: ['endsAt'] },
);

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// ── GDPR Template Schemas ────────────────────────────

export const gdprTemplateBodySchema = localizedStringField.refine(
  (obj) => Object.values(obj).some((v) => typeof v === 'string' && v.trim().length >= 20),
  { message: 'At least one locale must contain ≥20 characters' },
);

export const createGdprTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  body: gdprTemplateBodySchema,
  isDefault: z.boolean().optional().default(false),
});

export const updateGdprTemplateSchema = createGdprTemplateSchema.partial();

export type CreateGdprTemplateInput = z.infer<typeof createGdprTemplateSchema>;
export type UpdateGdprTemplateInput = z.infer<typeof updateGdprTemplateSchema>;

// ── Legacy Event Import Schema ───────────────────────
//
// Legacy events (eventType=LEGACY) cover video archives the PA already
// owns (typically MsTeams recordings re-uploaded onto our Azure Blob
// via the admin UI). They skip Jitsi provisioning and registrations;
// all we persist is enough metadata to render the detail page and the
// library card.
//
// The mandatory field is `recordingUrl`: the blob URL returned by the
// SAS-signed upload endpoint. `youtubeUrl` stays optional as an
// external-reference link to the original YouTube upload (surfaced as
// a "Watch on YouTube" link, never embedded).
export const createLegacyEventSchema = z.object({
  title: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 3,
    { message: 'title.it is required and must be at least 3 characters' },
  ),
  description: localizedStringField.optional().default({ it: '' }),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  recordingUrl: z.string().url(),
  recordingFileSize: z.number().int().positive().optional(),
  recordingDuration: z.number().int().positive().optional(),
  youtubeUrl: z
    .string()
    .url()
    .refine(
      (u) => /(?:youtube\.com|youtu\.be)/i.test(u),
      { message: 'URL must point to youtube.com or youtu.be' },
    )
    .nullable()
    .optional(),
  coverImageUrl: z.string().url().optional(),
  speakersInfo: localizedStringField.optional(),
  organizerName: z.string().max(200).optional(),
  libraryListed: z.boolean().optional().default(true),
});
export type CreateLegacyEventInput = z.infer<typeof createLegacyEventSchema>;

// ── Instant Call Schema ──────────────────────────────

export const createInstantCallSchema = z.object({
  title: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 2,
    { message: 'title.it is required and must be at least 2 characters' },
  ),
  moderatorName: z.string().min(2).max(100).optional(),
  joinPassword: z.string().min(4).max(200).optional(),
  // Capacity hint for the JVB auto-scaler. Optional — route applies a
  // conservative default when omitted. Operators sizing a demo for a
  // large audience should set this up-front so the scaler provisions
  // enough replicas on the next tick instead of reactive catch-up.
  maxParticipants: z.number().int().min(2).max(500).optional(),
});

// ── Registration Schemas ─────────────────────────────

export const ORGANIZATION_TYPES = [
  'MINISTRY', 'AGENCY', 'REGION', 'PROVINCE', 'MUNICIPALITY',
  'ASL', 'UNIVERSITY', 'PUBLIC_ENTITY', 'IN_HOUSE', 'OTHER',
] as const;

export const createRegistrationSchema = z.object({
  displayName: z
    .string()
    .min(2, 'registration.errors.nameRequired')
    .max(100),
  email: z
    .string()
    .email('registration.errors.emailInvalid'),
  organization: z.string().max(200).optional(),
  organizationRole: z.string().max(200).optional(),
  organizationType: z.enum(ORGANIZATION_TYPES).optional(),
  consentGiven: z
    .literal(true, {
      errorMap: () => ({ message: 'registration.errors.consentRequired' }),
    }),
  consentRecording: z.boolean().optional(),
  consentFutureCommunications: z.boolean().default(false),
  // Rubrica (Person address book) opt-in. This is a SEPARATE Art. 6.1.a
  // consent from the event-registration Art. 6.1.b basis — it controls
  // whether the participant's stable profile (email, display name,
  // organization) is indexed in the cross-event address book. Default
  // false means: unchecked is "no", which is the GDPR-required starting
  // state for opt-in consent.
  consentAddressBook: z.boolean().default(false),
});

export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

// ── Q&A Schemas ──────────────────────────────────────

export const createQuestionSchema = z.object({
  text: z
    .string()
    .min(3, 'qa.errors.textRequired')
    .max(500, 'qa.errors.tooLong'),
});

export const updateQuestionStatusSchema = z.object({
  status: z.enum(['PENDING', 'HIGHLIGHTED', 'ANSWERED', 'DISMISSED']),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionStatusInput = z.infer<typeof updateQuestionStatusSchema>;

// ── Jitsi Token Schema ───────────────────────────────

export const jitsiTokenRequestSchema = z.object({
  accessToken: z.string().min(1).optional(),
  moderatorToken: z.string().uuid().optional(),
  guestName: z.string().min(2).max(100).optional(),
  displayNameOverride: z.string().min(2).max(100).optional(),
}).refine(
  (data) => data.accessToken ?? data.moderatorToken ?? data.guestName,
  { message: 'Either accessToken, moderatorToken, or guestName is required' },
).refine(
  (data) => {
    const provided = [data.accessToken, data.moderatorToken, data.guestName].filter(Boolean);
    return provided.length === 1;
  },
  { message: 'Exactly one of accessToken, moderatorToken, or guestName must be provided' },
);

export type JitsiTokenRequest = z.infer<typeof jitsiTokenRequestSchema>;

// ── Poll Schemas ────────────────────────────────────────

export const createPollSchema = z.object({
  question: z.string().min(3).max(300),
  options: z.array(z.string().min(1).max(200)).min(2).max(6),
});

export const updatePollStatusSchema = z.object({
  status: z.enum(['OPEN', 'CLOSED', 'PUBLISHED']),
});

export const pollVoteSchema = z.object({
  optionIndex: z.number().int().min(0),
  accessToken: z.string().min(1).optional(),
  guestId: z.string().min(1).optional(),
}).refine(
  (data) => data.accessToken || data.guestId,
  { message: 'Either accessToken or guestId is required' },
);

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type PollVoteInput = z.infer<typeof pollVoteSchema>;

// ── Material Schemas ───────────────────────────────────

export const createMaterialSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url(),
  description: z.string().max(500).optional(),
});

export type CreateMaterialInput = z.infer<typeof createMaterialSchema>;

// ── Reminder Schemas ───────────────────────────────────

export const REMINDER_PRESETS = [
  { offsetMinutes: 10080, labelIt: '7 giorni prima', labelEn: '7 days before' },
  { offsetMinutes: 4320, labelIt: '3 giorni prima', labelEn: '3 days before' },
  { offsetMinutes: 1440, labelIt: '1 giorno prima', labelEn: '1 day before' },
  { offsetMinutes: 720, labelIt: '12 ore prima', labelEn: '12 hours before' },
  { offsetMinutes: 360, labelIt: '6 ore prima', labelEn: '6 hours before' },
  { offsetMinutes: 180, labelIt: '3 ore prima', labelEn: '3 hours before' },
  { offsetMinutes: 60, labelIt: '1 ora prima', labelEn: '1 hour before' },
  { offsetMinutes: 30, labelIt: '30 minuti prima', labelEn: '30 minutes before' },
  { offsetMinutes: 15, labelIt: '15 minuti prima', labelEn: '15 minutes before' },
] as const;

export const VALID_OFFSETS: number[] = REMINDER_PRESETS.map((p) => p.offsetMinutes);

export const createReminderSchema = z.object({
  offsetMinutes: z.number().int().refine(
    (v) => VALID_OFFSETS.includes(v),
    { message: 'Invalid offset' },
  ),
});

// ── Feedback Schemas ────────────────────────────────────

export const createFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
  accessToken: z.string().min(1).optional(),
  guestId: z.string().min(1).optional(),
}).refine(
  (data) => data.accessToken || data.guestId,
  { message: 'Either accessToken or guestId is required' },
);

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;

// ── Word Cloud Schemas ──────────────────────────────────

export const createWordCloudRoundSchema = z.object({
  prompt: z.string().min(3).max(200),
  duration: z.number().int().min(30).max(300).default(120),
});

export const submitWordCloudSchema = z.object({
  word: z.string().min(1).max(30),
  accessToken: z.string().min(1).optional(),
  guestId: z.string().min(1).optional(),
}).refine(
  (data) => data.accessToken || data.guestId,
  { message: 'Either accessToken or guestId is required' },
);

export type CreateWordCloudRoundInput = z.infer<typeof createWordCloudRoundSchema>;
export type SubmitWordCloudInput = z.infer<typeof submitWordCloudSchema>;

// ── Timer Schemas ───────────────────────────────────────

export const timerActionSchema = z.object({
  action: z.enum(['start', 'pause', 'reset']),
  duration: z.number().int().min(10).max(7200).optional(),
  visible: z.boolean().optional(),
});

export type TimerActionInput = z.infer<typeof timerActionSchema>;

// ── Reaction Schemas ────────────────────────────────────

const VALID_EMOJIS = ['👏', '❤️', '😂', '🎉', '👍', '😮'] as const;

export const sendReactionSchema = z.object({
  emoji: z.enum(VALID_EMOJIS),
});

export { VALID_EMOJIS };
export type SendReactionInput = z.infer<typeof sendReactionSchema>;

// ── Questionnaire Schemas (fase A) ──────────────────────
//
// Shared between admin CRUD on templates/event-questionnaires and the
// public submission endpoint. The item value-shape changes by type,
// so the answer schema uses a discriminated union.

export const QUESTION_ITEM_TYPES = [
  'SINGLE_CHOICE', 'MULTI_CHOICE', 'YES_NO', 'LIKERT', 'OPEN_TEXT',
] as const;

export const QUESTIONNAIRE_PLACEMENTS = ['PRE_REGISTRATION', 'POST_EVENT'] as const;

// Multilingual options: array of { it: "...", en: "..." }. At least one
// locale must be non-empty per option.
const optionLabelSchema = localizedStringField.refine(
  (obj) => Object.values(obj).some((v) => typeof v === 'string' && v.trim().length > 0),
  { message: 'option must have at least one non-empty locale' },
);

export const questionItemSchema = z.object({
  id: z.string().uuid().optional(), // present on update, absent on create
  prompt: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 3,
    { message: 'prompt.it is required' },
  ),
  type: z.enum(QUESTION_ITEM_TYPES),
  options: z.array(optionLabelSchema).min(2).max(12).optional(),
  scaleMin: z.number().int().min(1).max(10).optional(),
  scaleMax: z.number().int().min(2).max(11).optional(),
  scaleMinLabel: localizedStringField.optional(),
  scaleMaxLabel: localizedStringField.optional(),
  required: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
}).refine(
  (it) => {
    if (it.type === 'SINGLE_CHOICE' || it.type === 'MULTI_CHOICE') {
      return Array.isArray(it.options) && it.options.length >= 2;
    }
    return true;
  },
  { message: 'SINGLE_CHOICE / MULTI_CHOICE require ≥2 options', path: ['options'] },
).refine(
  (it) => {
    if (it.type === 'LIKERT') {
      const min = it.scaleMin ?? 1;
      const max = it.scaleMax ?? 5;
      return max > min;
    }
    return true;
  },
  { message: 'LIKERT requires scaleMax > scaleMin', path: ['scaleMax'] },
);

export const createQuestionTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).default(0),
  items: z.array(questionItemSchema).default([]),
});

export const updateQuestionTemplateSchema = createQuestionTemplateSchema.partial();

export type CreateQuestionTemplateInput = z.infer<typeof createQuestionTemplateSchema>;
export type UpdateQuestionTemplateInput = z.infer<typeof updateQuestionTemplateSchema>;
export type QuestionItemInput = z.infer<typeof questionItemSchema>;

export const upsertEventQuestionnaireSchema = z.object({
  placement: z.enum(QUESTIONNAIRE_PLACEMENTS),
  title: localizedStringField.optional().default({}),
  description: localizedStringField.optional().default({}),
  required: z.boolean().default(false),
  allowEdit: z.boolean().default(false),
  templateIds: z.array(z.string().uuid()).default([]),
  adhocItems: z.array(questionItemSchema).default([]),
});

export type UpsertEventQuestionnaireInput = z.infer<typeof upsertEventQuestionnaireSchema>;

// Submission: one answer per item. Value shape discriminates on the
// item's type at runtime (not enforced in the schema because we don't
// know item types at parse time; the service layer validates each
// answer against its item).
export const questionnaireAnswerInputSchema = z.object({
  itemId: z.string().uuid(),
  valueText: z.string().max(2000).nullable().optional(),
  valueChoices: z.array(z.number().int().min(0).max(50)).max(12).nullable().optional(),
  valueScale: z.number().int().min(0).max(11).nullable().optional(),
});

export const submitQuestionnaireResponseSchema = z.object({
  answers: z.array(questionnaireAnswerInputSchema).max(100),
  accessToken: z.string().min(1).optional(),
  guestId: z.string().min(1).optional(),
  respondentName: z.string().max(120).optional(),
}).refine(
  (data) => data.accessToken || data.guestId,
  { message: 'Either accessToken or guestId is required' },
);

export type SubmitQuestionnaireResponseInput = z.infer<typeof submitQuestionnaireResponseSchema>;
export type QuestionnaireAnswerInput = z.infer<typeof questionnaireAnswerInputSchema>;

// ── Admin asset upload response ──────────────────────
//
// Shape returned by POST /api/admin/assets/upload-url. Kept as a
// standalone schema so client-side callers (FileOrUrlInput and the
// admin wizard forms) can import the TS type without duplicating the
// response contract.
export const assetUploadResponseSchema = z.object({
  /** Canonical public URL of the uploaded object (no signature). */
  url: z.string().url(),
  /** Object-storage key under `assets/{type}/{yyyy}/{mm}/...`. */
  key: z.string().min(1),
  /** MIME type accepted and stored with the blob. */
  mime: z.string().min(1),
  /** Size in bytes, as observed server-side. */
  size: z.number().int().nonnegative(),
  /** Original filename (sanitized) — surfaced for display in the UI. */
  filename: z.string().min(1),
});

export type AssetUploadResponse = z.infer<typeof assetUploadResponseSchema>;
