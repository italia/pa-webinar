import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createFeedbackSchema } from '@/lib/validation/schemas';
import { constantTimeEqual } from '@/lib/auth/moderator';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/events/[slug]/feedback — submit feedback
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const ip = getClientIp(request);
  const rl = rateLimit(`feedback:${ip}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  if (!['LIVE', 'ENDED'].includes(event.status)) {
    throw new ConflictError('Feedback is only accepted for live or ended events');
  }

  const body = await parseJsonBody(request);
  const parsed = createFeedbackSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { rating, comment, accessToken, guestId } = parsed.data;

  let registrationId: string | null = null;

  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    registrationId = reg.id;

    const existing = await prisma.eventFeedback.findUnique({
      where: { eventId_registrationId: { eventId: event.id, registrationId: reg.id } },
    });
    if (existing) throw new ConflictError('Feedback already submitted');
  } else if (guestId) {
    const existing = await prisma.eventFeedback.findUnique({
      where: { eventId_guestId: { eventId: event.id, guestId } },
    });
    if (existing) throw new ConflictError('Feedback already submitted');
  }

  const feedback = await prisma.eventFeedback.create({
    data: {
      eventId: event.id,
      registrationId,
      guestId: guestId || null,
      rating,
      comment: comment || null,
    },
  });

  return Response.json(
    { id: feedback.id, rating: feedback.rating },
    { status: 201 },
  );
});

// GET /api/events/[slug]/feedback — get feedback (moderator: all, public: summary)
export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : new URL(request.url).searchParams.get('token');

  const isModerator = token ? constantTimeEqual(event.moderatorToken, token) : false;

  const feedback = await prisma.eventFeedback.findMany({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
  });

  const totalCount = feedback.length;
  const averageRating = totalCount > 0
    ? Math.round((feedback.reduce((sum, f) => sum + f.rating, 0) / totalCount) * 10) / 10
    : 0;

  const distribution = [0, 0, 0, 0, 0];
  for (const f of feedback) {
    const idx = f.rating - 1;
    if (idx >= 0 && idx < distribution.length) {
      distribution[idx] = (distribution[idx] ?? 0) + 1;
    }
  }

  if (isModerator) {
    return Response.json({
      averageRating,
      totalCount,
      distribution,
      feedback: feedback.map((f) => ({
        id: f.id,
        rating: f.rating,
        comment: f.comment,
        createdAt: f.createdAt.toISOString(),
      })),
    });
  }

  return Response.json({
    averageRating,
    totalCount,
    distribution,
  });
});
