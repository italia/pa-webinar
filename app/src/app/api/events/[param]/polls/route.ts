import { type PollStatus } from '@prisma/client';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import {
  isEventModerator,
  isEventModeratorCached,
  extractModeratorToken,
} from '@/lib/auth/moderator';
import { prisma } from '@/lib/db';
import { createPollSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

// ── GET /api/events/[slug]/polls ─────────────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : new URL(request.url).searchParams.get('token');

  if (!token) throw new UnauthorizedError('Token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  // Cache-ata: GET pollata da ogni partecipante, vedi questions/route.ts.
  const isModerator = await isEventModeratorCached(event, token);

  const where = isModerator
    ? { eventId: event.id }
    : { eventId: event.id, status: { in: ['OPEN', 'PUBLISHED'] as PollStatus[] } };

  let registrationId: string | null = null;
  if (!isModerator) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { id: true },
    });
    registrationId = reg?.id ?? null;
  }

  const polls = await prisma.poll.findMany({
    where,
    include: {
      _count: { select: { votes: true } },
      votes: {
        select: { optionIndex: true, registrationId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = polls.map((poll) => {
    const options = poll.options as string[];
    const totalVotes = poll._count.votes;

    const optionCounts = options.map((_, idx) =>
      poll.votes.filter((v) => v.optionIndex === idx).length,
    );

    const hasVoted = registrationId
      ? poll.votes.some((v) => v.registrationId === registrationId)
      : false;

    const votedOptionIndex = registrationId
      ? poll.votes.find((v) => v.registrationId === registrationId)?.optionIndex ?? null
      : null;

    const showResults = isModerator || poll.status !== 'OPEN';

    return {
      id: poll.id,
      question: poll.question,
      options,
      status: poll.status,
      totalVotes,
      optionCounts: showResults ? optionCounts : null,
      hasVoted,
      votedOptionIndex,
      createdAt: poll.createdAt.toISOString(),
      closedAt: poll.closedAt?.toISOString() ?? null,
    };
  });

  return Response.json({ polls: result });
});

// ── POST /api/events/[slug]/polls ────────────────────────

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = createPollSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const poll = await prisma.poll.create({
    data: {
      eventId: event.id,
      question: parsed.data.question,
      options: parsed.data.options,
    },
  });

  return Response.json(
    {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      status: poll.status,
      totalVotes: 0,
      optionCounts: (poll.options as string[]).map(() => 0),
      hasVoted: false,
      votedOptionIndex: null,
      createdAt: poll.createdAt.toISOString(),
      closedAt: null,
    },
    { status: 201 },
  );
});
