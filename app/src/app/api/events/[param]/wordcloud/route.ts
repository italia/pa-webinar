import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createWordCloudRoundSchema } from '@/lib/validation/schemas';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';

export const dynamic = 'force-dynamic';

// POST /api/events/[slug]/wordcloud — create round (moderator)
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event || !(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const body = await parseJsonBody(request);
  const parsed = createWordCloudRoundSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  // Close any existing open rounds first
  await prisma.wordCloudRound.updateMany({
    where: { eventId: event.id, status: 'OPEN' },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  const round = await prisma.wordCloudRound.create({
    data: {
      eventId: event.id,
      prompt: parsed.data.prompt,
      duration: parsed.data.duration,
    },
  });

  return Response.json(
    {
      id: round.id,
      prompt: round.prompt,
      status: round.status,
      duration: round.duration,
      createdAt: round.createdAt.toISOString(),
      words: [],
    },
    { status: 201 },
  );
});

// GET /api/events/[slug]/wordcloud — get active round with aggregated words
export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const round = await prisma.wordCloudRound.findFirst({
    where: { eventId: event.id },
    orderBy: { createdAt: 'desc' },
    include: {
      submissions: {
        select: { word: true },
      },
    },
  });

  if (!round) {
    return Response.json({ active: false });
  }

  // Auto-close if duration exceeded
  if (round.status === 'OPEN') {
    const elapsedMs = Date.now() - round.createdAt.getTime();
    if (elapsedMs > round.duration * 1000) {
      await prisma.wordCloudRound.update({
        where: { id: round.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      round.status = 'CLOSED';
    }
  }

  // Aggregate word counts
  const wordCounts = new Map<string, number>();
  for (const s of round.submissions) {
    const normalized = s.word.toLowerCase().trim();
    wordCounts.set(normalized, (wordCounts.get(normalized) || 0) + 1);
  }

  const words = Array.from(wordCounts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);

  return Response.json({
    active: round.status === 'OPEN',
    id: round.id,
    prompt: round.prompt,
    status: round.status,
    duration: round.duration,
    createdAt: round.createdAt.toISOString(),
    closedAt: round.closedAt?.toISOString() ?? null,
    totalSubmissions: round.submissions.length,
    words,
  });
});
