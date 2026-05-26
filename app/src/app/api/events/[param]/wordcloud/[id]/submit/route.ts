import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { submitWordCloudSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// POST /api/events/[slug]/wordcloud/[id]/submit
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: roundId } = await context.params;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const ip = getClientIp(request);
  const ipRl = rateLimit(`wc-submit-ip:${ip}:${event.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!ipRl.allowed) {
    throw new RateLimitError((ipRl.resetAt - Date.now()) / 1000);
  }

  const round = await prisma.wordCloudRound.findUnique({
    where: { id: roundId },
    select: { id: true, eventId: true, status: true, duration: true, createdAt: true },
  });

  if (!round || round.eventId !== event.id) {
    throw new NotFoundError('Word cloud round');
  }

  if (round.status !== 'OPEN') {
    throw new ConflictError('Word cloud round is closed');
  }

  // Auto-close check
  const elapsedMs = Date.now() - round.createdAt.getTime();
  if (elapsedMs > round.duration * 1000) {
    await prisma.wordCloudRound.update({
      where: { id: round.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    throw new ConflictError('Word cloud round has expired');
  }

  const body = await parseJsonBody(request);
  const parsed = submitWordCloudSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { word, accessToken, guestId } = parsed.data;
  let rateLimitKey: string;

  if (accessToken) {
    const reg = await prisma.registration.findUnique({
      where: { accessToken },
      select: { id: true, eventId: true },
    });
    if (!reg || reg.eventId !== event.id) {
      throw new ForbiddenError('Invalid access token');
    }
    rateLimitKey = `wc:${reg.id}:${round.id}`;

    // Max 5 submissions per round
    const count = await prisma.wordCloudSubmission.count({
      where: { roundId: round.id, registrationId: reg.id },
    });
    if (count >= 5) {
      throw new ConflictError('Maximum submissions reached for this round');
    }
  } else if (guestId) {
    rateLimitKey = `wc:guest:${guestId}:${round.id}`;

    const count = await prisma.wordCloudSubmission.count({
      where: { roundId: round.id, guestId },
    });
    if (count >= 5) {
      throw new ConflictError('Maximum submissions reached for this round');
    }
  } else {
    throw new ForbiddenError('Authentication required');
  }

  const rl = rateLimit(rateLimitKey, { limit: 5, windowMs: 30_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  await prisma.wordCloudSubmission.create({
    data: {
      roundId: round.id,
      registrationId: accessToken
        ? (await prisma.registration.findUnique({ where: { accessToken }, select: { id: true } }))?.id
        : null,
      guestId: guestId || null,
      word: word.toLowerCase().trim(),
    },
  });

  return Response.json({ ok: true }, { status: 201 });
});
