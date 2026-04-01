import { z } from 'zod';

// ── Event Schemas ────────────────────────────────────

const eventBaseSchema = z.object({
  titleIt: z.string().min(3).max(200),
  titleEn: z.string().max(200).optional(),
  descriptionIt: z.string().min(10).max(5000),
  descriptionEn: z.string().max(5000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().default('Europe/Rome'),
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
  moderatorName: z.string().min(2).max(100).optional(),
  moderatorEmail: z.string().email().optional(),
  speakersIt: z.string().max(1000).optional(),
  speakersEn: z.string().max(1000).optional(),
  organizerName: z.string().max(200).optional(),
  imageUrl: z.string().url().optional(),
  waitingRoomAudioUrl: z.string().url().optional(),
});

export const createEventSchema = eventBaseSchema.refine(
  (data) => new Date(data.endsAt) > new Date(data.startsAt),
  { message: 'endsAt must be after startsAt', path: ['endsAt'] },
);

export const updateEventSchema = eventBaseSchema.partial().extend({
  status: z
    .enum(['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'ARCHIVED'])
    .optional(),
}).refine(
  (data) => {
    // Only validate date ordering when both dates are present in the update
    if (data.startsAt && data.endsAt) {
      return new Date(data.endsAt) > new Date(data.startsAt);
    }
    return true;
  },
  { message: 'endsAt must be after startsAt', path: ['endsAt'] },
);

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

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
