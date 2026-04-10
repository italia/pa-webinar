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
  maxParticipants: z.number().int().min(2).max(500).default(300),
  qaEnabled: z.boolean().default(true),
  chatEnabled: z.boolean().default(false),
  recordingEnabled: z.boolean().default(false),
  participantsCanUnmute: z.boolean().default(false),
  participantsCanStartVideo: z.boolean().default(false),
  participantsCanShareScreen: z.boolean().default(false),
  requireOrganization: z.boolean().default(false),
  requireOrganizationRole: z.boolean().default(false),
  requireOrganizationType: z.boolean().default(false),
  dataRetentionDays: z.number().int().min(1).max(365).default(30),
  privacyPolicyUrl: z.string().url().optional(),
  privacyPolicyText: z.string().max(10000).optional(),
  moderatorName: z.string().min(2).max(100).optional(),
  moderatorEmail: z.string().email().optional(),
  speakersInfo: localizedStringField.optional(),
  organizerName: z.string().max(200).optional(),
  imageUrl: z.string().url().optional(),
  waitingRoomAudioUrl: z.string().url().optional(),
  postEventPublic: z.boolean().default(true),
  postEventPublicUntil: z.string().datetime().nullable().optional(),
  postEventShowQA: z.boolean().default(true),
  postEventShowMaterials: z.boolean().default(true),
  postEventShowPolls: z.boolean().default(true),
  postEventShowFeedback: z.boolean().default(true),
  feedbackEnabled: z.boolean().default(true),
  recordingConsentText: z.string().max(5000).optional(),
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

// ── Instant Call Schema ──────────────────────────────

export const createInstantCallSchema = z.object({
  title: localizedStringField.refine(
    (obj) => typeof obj.it === 'string' && obj.it.length >= 2,
    { message: 'title.it is required and must be at least 2 characters' },
  ),
  moderatorName: z.string().min(2).max(100).optional(),
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
