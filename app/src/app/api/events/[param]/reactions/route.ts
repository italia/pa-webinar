import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { sendReactionSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { limiteDellaSala } from '@/lib/room-rate-limit';
import { contaReazione, leggiReazioni } from '@/lib/live/reactions-count';

export const dynamic = 'force-dynamic';

// Hard cap on persisted reaction rows per event: the POST is public (the live
// UX needs it), so this bounds table bloat from a spam/abuse burst. Real events
// stay far below it; the live counter (lib/live/reactions-count) is unaffected
// by the cap.
const REACTION_ROW_CAP = 20000;

// POST /api/events/[slug]/reactions — send a reaction
export const POST = withErrorHandling(async (request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!event) throw new NotFoundError('Event');

  const ip = getClientIp(request);
  const rl = rateLimit(`reaction:${ip}`, {
    limit: limiteDellaSala(30),
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = sendReactionSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const { emoji } = parsed.data;
  // Il contatore della diretta, condiviso da tutte le istanze dell'app.
  const total = await contaReazione(event.id, emoji);

  // P1 analytics — persist each reaction (one row per click; the POST is
  // already self-originated by the reactor, so there is no broadcast fan-out)
  // for post-event counts + the engagement timeline. Best-effort: the live
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

  return Response.json({ ok: true, emoji, total });
});

// GET /api/events/[slug]/reactions — get reaction counts
export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!event) throw new NotFoundError('Event');

  const counts = await leggiReazioni(event.id);
  const total = Object.values(counts).reduce((sum, c) => sum + c, 0);

  return Response.json({ counts, total });
});
