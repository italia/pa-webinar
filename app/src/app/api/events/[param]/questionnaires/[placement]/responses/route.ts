/**
 * Public submit endpoint for questionnaire responses.
 *
 * Identity:
 *   - `accessToken` → matched to a Registration on this event; submission
 *     is linked to that registration (and uniquely — one response per
 *     (questionnaire, registration)).
 *   - `guestId` → anonymous-ish client-generated id (e.g., stored in
 *     localStorage); one response per (questionnaire, guestId).
 *
 * Idempotency: if `allowEdit` is true on the questionnaire, a repeat
 * submission updates the existing response (delete+recreate answers in
 * the same transaction). If `allowEdit` is false, repeat → 409.
 */

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { hashEmail, tryDecryptPII } from '@/lib/crypto/pii';
import {
  findEventQuestionnaireByPlacement,
  submitResponse,
  validateAnswers,
} from '@/lib/questionnaires';
import { getClientIp, rateLimit } from '@/lib/rate-limit';
import {
  QUESTIONNAIRE_PLACEMENTS,
  submitQuestionnaireResponseSchema,
} from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST = withErrorHandling(async (request, context) => {
  const { param, placement: rawPlacement } = await context.params;
  if (!(QUESTIONNAIRE_PLACEMENTS as readonly string[]).includes(rawPlacement)) {
    throw new AppError(
      `placement must be one of: ${QUESTIONNAIRE_PLACEMENTS.join(', ')}`,
      400,
      'BAD_REQUEST',
    );
  }
  const placement = rawPlacement as (typeof QUESTIONNAIRE_PLACEMENTS)[number];

  const ip = getClientIp(request);
  const rl = rateLimit(`questionnaire:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({
    where: UUID_RE.test(param) ? { id: param } : { slug: param },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const q = await findEventQuestionnaireByPlacement(event.id, placement);
  if (!q) throw new NotFoundError('EventQuestionnaire');

  const body = await parseJsonBody(request);
  const parsed = submitQuestionnaireResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  const { answers, accessToken, guestId, respondentName } = parsed.data;

  let registrationId: string | null = null;
  let respondentEmailHash: string | null = null;
  let nameFromRegistration: string | null = null;

  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true, email: true, displayName: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    registrationId = reg.id;
    respondentEmailHash = hashEmail(reg.email);
    nameFromRegistration = tryDecryptPII(reg.displayName) ?? reg.displayName;
  }

  const normalized = validateAnswers(q, answers);

  const result = await submitResponse({
    questionnaire: q,
    registrationId,
    guestId: guestId ?? null,
    respondentName: nameFromRegistration ?? respondentName ?? null,
    respondentEmailHash,
    answers: normalized,
  });

  return Response.json(result, { status: result.created ? 201 : 200 });
});
