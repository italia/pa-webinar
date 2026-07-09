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

// Hard cap on persisted reaction rows per event: the POST is public (the live
// UX needs it), so this bounds table bloat from a spam/abuse burst. Real events
// stay far below it; the in-memory live counter is unaffected by the cap.
const REACTION_ROW_CAP = 20000;

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

  // P1 analytics — persist each reaction (one row per click; the POST is
  // already self-originated by the reactor, so there is no broadcast fan-out)
  // for post-event counts + the engagement timeline. Best-effort: the in-memory
  // counter above drives the real-time UX, so a DB hiccup must not fail the
  // click. No PII stored — only the emoji + timestamp. The conditional INSERT
  // caps rows per event (bounds bloat from an unauthenticated spam burst);
  // gen_random_uuid() supplies the id server-side.
  try {
    await prisma.$executeRaw`
      INSERT INTO "reactions" ("id", "event_id", "emoji", "created_at")
      SELECT gen_random_uuid(), ${event.id}::uuid, ${emoji}, CURRENT_TIMESTAMP
      WHERE (SELECT count(*) FROM "reactions" WHERE "event_id" = ${event.id}::uuid) < ${REACTION_ROW_CAP}
    `;
  } catch {
    /* analytics-only; never break the live reaction */
  }

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
