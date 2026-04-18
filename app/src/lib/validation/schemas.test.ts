import { describe, it, expect } from 'vitest';
import {
  createEventSchema,
  updateEventSchema,
  createRegistrationSchema,
  createQuestionSchema,
  updateQuestionStatusSchema,
  jitsiTokenRequestSchema,
  createMaterialSchema,
  createReminderSchema,
  createPollSchema,
  updatePollStatusSchema,
  pollVoteSchema,
  createInstantCallSchema,
  VALID_OFFSETS,
} from './schemas';

// ── Helpers ─────────────────────────────────────────────────

const futureDate = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3600_000).toISOString();

const validEvent = () => ({
  title: { it: 'PA Digitale 2026' },
  description: { it: 'Un evento sulla digitalizzazione della PA italiana.' },
  startsAt: futureDate(24),
  endsAt: futureDate(26),
});

// ── createEventSchema ───────────────────────────────────────

describe('createEventSchema', () => {
  it('accepts valid minimal input', () => {
    const result = createEventSchema.safeParse(validEvent());
    expect(result.success).toBe(true);
  });

  it('accepts valid full input', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      title: { it: 'PA Digitale 2026', en: 'PA Digital 2026' },
      description: { it: 'Un evento sulla digitalizzazione della PA italiana.', en: 'An event about Italian PA digitalization.' },
      timezone: 'Europe/Rome',
      maxParticipants: 100,
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: true,
      moderatorName: 'Mario Rossi',
      moderatorEmail: 'mario@example.com',
      speakersInfo: { it: 'Mario Rossi, Luigi Verdi' },
      organizerName: 'DTD',
      privacyPolicyUrl: 'https://example.com/privacy',
      privacyPolicyText: 'Testo privacy',
      imageUrl: 'https://example.com/img.png',
      dataRetentionDays: 60,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const { title: _, ...rest } = validEvent();
    const result = createEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects missing description', () => {
    const { description: _, ...rest } = validEvent();
    const result = createEventSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects title.it shorter than 3 chars', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), title: { it: 'AB' } });
    expect(result.success).toBe(false);
  });

  it('rejects description.it shorter than 10 chars', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), description: { it: 'Short' } });
    expect(result.success).toBe(false);
  });

  it('rejects title without it locale', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), title: { en: 'English only' } });
    expect(result.success).toBe(false);
  });

  it('rejects description without it locale', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), description: { en: 'English only description here.' } });
    expect(result.success).toBe(false);
  });

  it('rejects end before start', () => {
    const result = createEventSchema.safeParse({
      ...validEvent(),
      startsAt: futureDate(26),
      endsAt: futureDate(24),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('endsAt'))).toBe(true);
    }
  });

  it('rejects equal start and end', () => {
    const same = futureDate(24);
    const result = createEventSchema.safeParse({
      ...validEvent(),
      startsAt: same,
      endsAt: same,
    });
    expect(result.success).toBe(false);
  });

  it('rejects maxParticipants of 0', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), maxParticipants: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects maxParticipants of 1', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), maxParticipants: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects maxParticipants over 10000', () => {
    // The hard cap is 10_000 because the field is now an *estimate* of
    // expected attendance (not a hard per-event capacity). The cap
    // protects against typos; anything above that would indicate a
    // form error or abuse.
    const result = createEventSchema.safeParse({ ...validEvent(), maxParticipants: 10001 });
    expect(result.success).toBe(false);
  });

  it('accepts maxParticipants up to 10000', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), maxParticipants: 10000 });
    expect(result.success).toBe(true);
  });

  it('rejects negative maxParticipants', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), maxParticipants: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid datetime format for startsAt', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), startsAt: 'not-a-date' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid privacyPolicyUrl', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), privacyPolicyUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('defaults maxParticipants to 300', () => {
    const result = createEventSchema.safeParse(validEvent());
    if (result.success) {
      expect(result.data.maxParticipants).toBe(300);
    }
  });

  it('defaults qaEnabled to true', () => {
    const result = createEventSchema.safeParse(validEvent());
    if (result.success) {
      expect(result.data.qaEnabled).toBe(true);
    }
  });

  it('defaults dataRetentionDays to 30', () => {
    const result = createEventSchema.safeParse(validEvent());
    if (result.success) {
      expect(result.data.dataRetentionDays).toBe(30);
    }
  });

  it('rejects dataRetentionDays over 365', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), dataRetentionDays: 366 });
    expect(result.success).toBe(false);
  });

  // ── Per-event sizing + grace period overrides ─────────────
  // Both fields are `.nullable().optional()` — null/omitted means
  // "inherit the SiteSetting default". Keep allowed bounds tight so an
  // admin can't set `gracePeriodMinutes: 99999` and blow the scaler.

  it('accepts expectedSenderRatioPct at bounds (0 and 100)', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: 0 }).success).toBe(true);
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: 100 }).success).toBe(true);
  });

  it('accepts expectedSenderRatioPct: null (inherit default)', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: null }).success).toBe(true);
  });

  it('rejects expectedSenderRatioPct over 100', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: 101 }).success).toBe(false);
  });

  it('rejects negative expectedSenderRatioPct', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: -1 }).success).toBe(false);
  });

  it('rejects non-integer expectedSenderRatioPct', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), expectedSenderRatioPct: 33.5 }).success).toBe(false);
  });

  it('accepts gracePeriodMinutes: -1 (never auto-close)', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), gracePeriodMinutes: -1 }).success).toBe(true);
  });

  it('accepts gracePeriodMinutes: 0, 5, 15, 30, 60', () => {
    for (const v of [0, 5, 15, 30, 60]) {
      expect(createEventSchema.safeParse({ ...validEvent(), gracePeriodMinutes: v }).success).toBe(true);
    }
  });

  it('accepts gracePeriodMinutes at upper bound (240)', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), gracePeriodMinutes: 240 }).success).toBe(true);
  });

  it('rejects gracePeriodMinutes below -1', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), gracePeriodMinutes: -2 }).success).toBe(false);
  });

  it('rejects gracePeriodMinutes over 240', () => {
    expect(createEventSchema.safeParse({ ...validEvent(), gracePeriodMinutes: 241 }).success).toBe(false);
  });
});

// ── createEventSchema — timezone validation ─────────────────

describe('createEventSchema timezone', () => {
  it('accepts Europe/Rome', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), timezone: 'Europe/Rome' });
    expect(result.success).toBe(true);
  });

  it('accepts America/New_York', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), timezone: 'America/New_York' });
    expect(result.success).toBe(true);
  });

  it('accepts Asia/Tokyo', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), timezone: 'Asia/Tokyo' });
    expect(result.success).toBe(true);
  });

  it('rejects Invalid/Zone', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), timezone: 'Invalid/Zone' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    const result = createEventSchema.safeParse({ ...validEvent(), timezone: '' });
    expect(result.success).toBe(false);
  });

  it('defaults to Europe/Rome when omitted', () => {
    const result = createEventSchema.safeParse(validEvent());
    if (result.success) {
      expect(result.data.timezone).toBe('Europe/Rome');
    }
  });
});

// ── updateEventSchema ───────────────────────────────────────

describe('updateEventSchema', () => {
  it('accepts empty partial update', () => {
    const result = updateEventSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts partial update with just title', () => {
    const result = updateEventSchema.safeParse({ title: { it: 'Nuovo Titolo' } });
    expect(result.success).toBe(true);
  });

  it('accepts valid status values', () => {
    for (const status of ['DRAFT', 'PUBLISHED', 'LIVE', 'ENDED']) {
      const result = updateEventSchema.safeParse({ status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects ARCHIVED status (internal only)', () => {
    const result = updateEventSchema.safeParse({ status: 'ARCHIVED' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = updateEventSchema.safeParse({ status: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('validates date ordering when both dates present', () => {
    const result = updateEventSchema.safeParse({
      startsAt: futureDate(26),
      endsAt: futureDate(24),
    });
    expect(result.success).toBe(false);
  });

  it('allows single date without ordering check', () => {
    const result = updateEventSchema.safeParse({ startsAt: futureDate(24) });
    expect(result.success).toBe(true);
  });
});

// ── createRegistrationSchema ────────────────────────────────

describe('createRegistrationSchema', () => {
  const validReg = () => ({
    displayName: 'Mario Rossi',
    email: 'mario@example.com',
    consentGiven: true as const,
  });

  it('accepts valid input', () => {
    const result = createRegistrationSchema.safeParse(validReg());
    expect(result.success).toBe(true);
  });

  it('accepts with optional fields', () => {
    const result = createRegistrationSchema.safeParse({
      ...validReg(),
      organization: 'AGID',
      organizationRole: 'Developer',
      organizationType: 'AGENCY',
      consentRecording: true,
      consentFutureCommunications: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing displayName', () => {
    const { displayName: _, ...rest } = validReg();
    const result = createRegistrationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects short displayName', () => {
    const result = createRegistrationSchema.safeParse({ ...validReg(), displayName: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = createRegistrationSchema.safeParse({ ...validReg(), email: 'not-email' });
    expect(result.success).toBe(false);
  });

  it('rejects consentGiven = false', () => {
    const result = createRegistrationSchema.safeParse({ ...validReg(), consentGiven: false });
    expect(result.success).toBe(false);
  });

  it('rejects invalid organizationType', () => {
    const result = createRegistrationSchema.safeParse({ ...validReg(), organizationType: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('defaults consentFutureCommunications to false', () => {
    const result = createRegistrationSchema.safeParse(validReg());
    if (result.success) {
      expect(result.data.consentFutureCommunications).toBe(false);
    }
  });
});

// ── createQuestionSchema ────────────────────────────────────

describe('createQuestionSchema', () => {
  it('accepts valid text', () => {
    const result = createQuestionSchema.safeParse({ text: 'Come funziona il PNRR?' });
    expect(result.success).toBe(true);
  });

  it('rejects empty text', () => {
    const result = createQuestionSchema.safeParse({ text: '' });
    expect(result.success).toBe(false);
  });

  it('rejects text under 3 chars', () => {
    const result = createQuestionSchema.safeParse({ text: 'Hi' });
    expect(result.success).toBe(false);
  });

  it('rejects text over 500 chars', () => {
    const result = createQuestionSchema.safeParse({ text: 'A'.repeat(501) });
    expect(result.success).toBe(false);
  });

  it('accepts text at exactly 500 chars', () => {
    const result = createQuestionSchema.safeParse({ text: 'A'.repeat(500) });
    expect(result.success).toBe(true);
  });
});

// ── updateQuestionStatusSchema ──────────────────────────────

describe('updateQuestionStatusSchema', () => {
  it.each(['PENDING', 'HIGHLIGHTED', 'ANSWERED', 'DISMISSED'])(
    'accepts status "%s"',
    (status) => {
      const result = updateQuestionStatusSchema.safeParse({ status });
      expect(result.success).toBe(true);
    },
  );

  it('rejects invalid status', () => {
    const result = updateQuestionStatusSchema.safeParse({ status: 'OPEN' });
    expect(result.success).toBe(false);
  });
});

// ── jitsiTokenRequestSchema ─────────────────────────────────

describe('jitsiTokenRequestSchema', () => {
  it('accepts with accessToken only', () => {
    const result = jitsiTokenRequestSchema.safeParse({ accessToken: 'abc123' });
    expect(result.success).toBe(true);
  });

  it('accepts with moderatorToken only', () => {
    const result = jitsiTokenRequestSchema.safeParse({
      moderatorToken: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with guestName only', () => {
    const result = jitsiTokenRequestSchema.safeParse({ guestName: 'Ospite Pubblico' });
    expect(result.success).toBe(true);
  });

  it('rejects with no token at all', () => {
    const result = jitsiTokenRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects with both accessToken and moderatorToken', () => {
    const result = jitsiTokenRequestSchema.safeParse({
      accessToken: 'abc123',
      moderatorToken: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects moderatorToken that is not UUID', () => {
    const result = jitsiTokenRequestSchema.safeParse({ moderatorToken: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects guestName shorter than 2 chars', () => {
    const result = jitsiTokenRequestSchema.safeParse({ guestName: 'A' });
    expect(result.success).toBe(false);
  });
});

// ── createPollSchema ────────────────────────────────────────

describe('createPollSchema', () => {
  it('accepts valid poll', () => {
    const result = createPollSchema.safeParse({
      question: 'Qual è la piattaforma preferita?',
      options: ['SPID', 'CIE', 'Entrambe'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty question', () => {
    const result = createPollSchema.safeParse({ question: '', options: ['A', 'B'] });
    expect(result.success).toBe(false);
  });

  it('rejects too few options (1)', () => {
    const result = createPollSchema.safeParse({ question: 'Test poll?', options: ['A'] });
    expect(result.success).toBe(false);
  });

  it('rejects too many options (7)', () => {
    const result = createPollSchema.safeParse({
      question: 'Test poll?',
      options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts 6 options (max)', () => {
    const result = createPollSchema.safeParse({
      question: 'Test poll?',
      options: ['A', 'B', 'C', 'D', 'E', 'F'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty option string', () => {
    const result = createPollSchema.safeParse({ question: 'Test poll?', options: ['A', ''] });
    expect(result.success).toBe(false);
  });
});

// ── updatePollStatusSchema ──────────────────────────────────

describe('updatePollStatusSchema', () => {
  it.each(['OPEN', 'CLOSED', 'PUBLISHED'])('accepts status "%s"', (status) => {
    const result = updatePollStatusSchema.safeParse({ status });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = updatePollStatusSchema.safeParse({ status: 'DRAFT' });
    expect(result.success).toBe(false);
  });
});

// ── pollVoteSchema ──────────────────────────────────────────

describe('pollVoteSchema', () => {
  it('accepts with accessToken', () => {
    const result = pollVoteSchema.safeParse({ optionIndex: 0, accessToken: 'abc' });
    expect(result.success).toBe(true);
  });

  it('accepts with guestId', () => {
    const result = pollVoteSchema.safeParse({ optionIndex: 1, guestId: 'guest-123' });
    expect(result.success).toBe(true);
  });

  it('rejects without accessToken or guestId', () => {
    const result = pollVoteSchema.safeParse({ optionIndex: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative optionIndex', () => {
    const result = pollVoteSchema.safeParse({ optionIndex: -1, accessToken: 'abc' });
    expect(result.success).toBe(false);
  });
});

// ── createMaterialSchema ────────────────────────────────────

describe('createMaterialSchema', () => {
  it('accepts valid input', () => {
    const result = createMaterialSchema.safeParse({
      title: 'Slide Presentation',
      url: 'https://example.com/slides.pdf',
    });
    expect(result.success).toBe(true);
  });

  it('accepts with description', () => {
    const result = createMaterialSchema.safeParse({
      title: 'Slide',
      url: 'https://example.com/slides.pdf',
      description: 'Le slide della presentazione',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing title', () => {
    const result = createMaterialSchema.safeParse({ url: 'https://example.com/slides.pdf' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = createMaterialSchema.safeParse({ title: 'Slide', url: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects empty title', () => {
    const result = createMaterialSchema.safeParse({ title: '', url: 'https://example.com' });
    expect(result.success).toBe(false);
  });
});

// ── createReminderSchema ────────────────────────────────────

describe('createReminderSchema', () => {
  it('accepts valid preset offset (60 = 1 hour)', () => {
    const result = createReminderSchema.safeParse({ offsetMinutes: 60 });
    expect(result.success).toBe(true);
  });

  it('accepts all valid offsets', () => {
    for (const offset of VALID_OFFSETS) {
      const result = createReminderSchema.safeParse({ offsetMinutes: offset });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid offset', () => {
    const result = createReminderSchema.safeParse({ offsetMinutes: 42 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer offset', () => {
    const result = createReminderSchema.safeParse({ offsetMinutes: 60.5 });
    expect(result.success).toBe(false);
  });
});

// ── createInstantCallSchema ─────────────────────────────────

describe('createInstantCallSchema', () => {
  it('accepts valid minimal input (title only)', () => {
    const result = createInstantCallSchema.safeParse({ title: { it: 'Quick sync' } });
    expect(result.success).toBe(true);
  });

  it('accepts with moderatorName', () => {
    const result = createInstantCallSchema.safeParse({
      title: { it: 'Demo progetto' },
      moderatorName: 'Mario Rossi',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.moderatorName).toBe('Mario Rossi');
    }
  });

  it('rejects missing title', () => {
    const result = createInstantCallSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects title.it shorter than 2 chars', () => {
    const result = createInstantCallSchema.safeParse({ title: { it: 'A' } });
    expect(result.success).toBe(false);
  });

  it('rejects title without it locale', () => {
    const result = createInstantCallSchema.safeParse({ title: { en: 'English only' } });
    expect(result.success).toBe(false);
  });

  it('rejects moderatorName shorter than 2 chars', () => {
    const result = createInstantCallSchema.safeParse({
      title: { it: 'Valid title' },
      moderatorName: 'A',
    });
    expect(result.success).toBe(false);
  });

  it('moderatorName is optional (undefined)', () => {
    const result = createInstantCallSchema.safeParse({ title: { it: 'Valid title' } });
    if (result.success) {
      expect(result.data.moderatorName).toBeUndefined();
    }
  });

  it('does not require dates, descriptions, or other event fields', () => {
    const result = createInstantCallSchema.safeParse({
      title: { it: 'Instant call' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ title: { it: 'Instant call' } });
    }
  });
});
