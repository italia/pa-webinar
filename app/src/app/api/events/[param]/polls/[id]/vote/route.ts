import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
  RateLimitError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { pollVoteSchema } from '@/lib/validation/schemas';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// ── POST /api/events/[slug]/polls/[id]/vote ──

export const POST = withErrorHandling(async (request, context) => {
  const { param: slug, id: pollId } = await context.params;

  const body = await parseJsonBody(request);
  const parsed = pollVoteSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { optionIndex, accessToken, guestId } = parsed.data;

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new NotFoundError('Event');

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { id: true, eventId: true, status: true, options: true },
  });

  if (!poll || poll.eventId !== event.id) {
    throw new NotFoundError('Poll');
  }

  if (poll.status !== 'OPEN') {
    throw new ConflictError('Poll is closed');
  }

  const options = poll.options as string[];
  if (optionIndex >= options.length) {
    throw new AppError('Invalid option index', 400, 'BAD_REQUEST');
  }

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

    const rl = rateLimit(`poll-vote:${reg.id}`, { limit: 10, windowMs: 60_000 });
    if (!rl.allowed) throw new RateLimitError();

    const existing = await prisma.pollVote.findUnique({
      where: { pollId_registrationId: { pollId, registrationId: reg.id } },
    });
    if (existing) throw new ConflictError('Already voted');
  } else if (guestId) {
    const existing = await prisma.pollVote.findUnique({
      where: { pollId_guestId: { pollId, guestId } },
    });
    if (existing) throw new ConflictError('Already voted');
  }

  await prisma.pollVote.create({
    data: {
      pollId,
      registrationId,
      guestId: guestId || null,
      optionIndex,
    },
  });

  return Response.json({ ok: true, optionIndex }, { status: 201 });
});
