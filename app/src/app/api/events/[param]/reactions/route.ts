import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { sendReactionSchema, VALID_EMOJIS } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { getCached, setCache } from '@/lib/cache';

export const dynamic = 'force-dynamic';

type ReactionCounts = Record<string, number>;

function getReactionsKey(eventId: string): string {
  return `reactions:${eventId}`;
}

// POST /api/events/[slug]/reactions — send a reaction
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!event) throw new NotFoundError('Event');

  const ip = getClientIp(request);
  const rl = rateLimit(`reaction:${ip}`, { limit: 30, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = sendReactionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { emoji } = parsed.data;
  const key = getReactionsKey(event.id);

  const TTL = 14400_000;
  let counts = getCached<ReactionCounts>(key);

  if (!counts) {
    counts = {};
    for (const e of VALID_EMOJIS) {
      counts[e] = 0;
    }
  }

  counts[emoji] = (counts[emoji] || 0) + 1;
  setCache(key, counts, TTL);

  return Response.json({ ok: true, emoji, total: counts[emoji] });
});

// GET /api/events/[slug]/reactions — get reaction counts
export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const key = getReactionsKey(event.id);
  let counts = getCached<ReactionCounts>(key);

  if (!counts) {
    counts = {};
    for (const e of VALID_EMOJIS) {
      counts[e] = 0;
    }
  }

  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return Response.json({ counts, total });
});
