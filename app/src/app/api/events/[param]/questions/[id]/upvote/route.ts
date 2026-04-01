import { withErrorHandling } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ── POST /api/events/[slug]/questions/[id]/upvote — toggle ──

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: questionId } = await context.params;

  let accessToken: string | undefined;
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && typeof body.accessToken === 'string') {
      accessToken = body.accessToken;
    }
  } catch {
    // body is optional, token can be in query
  }

  const token =
    accessToken ??
    new URL(request.url).searchParams.get('token');

  if (!token) throw new UnauthorizedError('Access token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const registration = await prisma.registration.findUnique({
    where: { accessToken: token },
    select: { id: true, eventId: true },
  });
  if (!registration || registration.eventId !== event.id) {
    throw new ForbiddenError('Invalid access token');
  }

  const rl = rateLimit(`upvote:${registration.id}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) throw new RateLimitError();

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true, eventId: true },
  });
  if (!question || question.eventId !== event.id) {
    throw new NotFoundError('Question');
  }

  const existing = await prisma.questionUpvote.findUnique({
    where: {
      questionId_registrationId: {
        questionId,
        registrationId: registration.id,
      },
    },
  });

  if (existing) {
    const [, updated] = await prisma.$transaction([
      prisma.questionUpvote.delete({ where: { id: existing.id } }),
      prisma.question.update({
        where: { id: questionId },
        data: { upvoteCount: { decrement: 1 } },
      }),
    ]);

    return Response.json({
      upvoted: false,
      upvoteCount: Math.max(0, updated.upvoteCount),
    });
  }

  const [, updated] = await prisma.$transaction([
    prisma.questionUpvote.create({
      data: { questionId, registrationId: registration.id },
    }),
    prisma.question.update({
      where: { id: questionId },
      data: { upvoteCount: { increment: 1 } },
    }),
  ]);

  return Response.json({
    upvoted: true,
    upvoteCount: updated.upvoteCount,
  });
});
