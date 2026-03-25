import { z } from 'zod';

// ── Event Schemas ────────────────────────────────────

export const createEventSchema = z.object({
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
  participantsCanUnmute: z.boolean().default(true),
  participantsCanStartVideo: z.boolean().default(true),
  participantsCanShareScreen: z.boolean().default(true),
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

export const updateEventSchema = createEventSchema.partial().extend({
  status: z
    .enum(['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED', 'ARCHIVED'])
    .optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// ── Registration Schemas ─────────────────────────────

export const createRegistrationSchema = z.object({
  displayName: z
    .string()
    .min(2, 'registration.errors.nameRequired')
    .max(100),
  email: z
    .string()
    .email('registration.errors.emailInvalid'),
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
  { message: 'Either accessToken, moderatorToken, or guestName is required' }
);

export type JitsiTokenRequest = z.infer<typeof jitsiTokenRequestSchema>;
