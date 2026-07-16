/**
 * POST /api/events/[param]/hand-raises/lower — moderator lowers ONE raised hand.
 *
 * F8: the Jitsi IFrame API cannot lower a REMOTE participant's hand (only the
 * local user's `toggleRaiseHand`). So this route does NOT change any Jitsi state
 * directly; it publishes a targeted `lowerHand` control signal on the event's
 * control channel. The addressed participant's own browser (subscribed to
 * /control/stream) then lowers ITS OWN hand, and Jitsi broadcasts
 * raiseHandUpdated(0) so every client's queue drains naturally.
 *
 * Moderator-only. Kept OFF the sibling `hand-raises/route.ts` (which is the
 * intentionally public, no-auth analytics ingest) — mixing a privileged action
 * onto a public handler would break the shared-contract rule.
 */

import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ValidationError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { eventParamWhere } from '@/lib/events/event-param';
import { isEventModerator, extractModeratorToken } from '@/lib/auth/moderator';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { publishControl } from '@/lib/live-control/pubsub';

export const dynamic = 'force-dynamic';

// Opaque Jitsi endpoint id (e.g. "abc12345"); bounded to keep the payload small
// and the broadcast free of anything that could carry PII.
const lowerHandSchema = z.object({
  targetEndpointId: z.string().min(1).max(256),
  // Jitsi's raise timestamp (evt.handRaised) for the raise being lowered. The
  // target client acts only if it matches its CURRENT raise id, so a stale
  // signal can't lower (and thus re-raise) a hand that was already lowered.
  raiseId: z.number().int().positive(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await prisma.event.findFirst({ where: eventParamWhere(param) });
  if (!event) throw new NotFoundError('Event');
  if (!(await isEventModerator(event, token))) {
    throw new ForbiddenError('Unauthorized');
  }

  const ip = getClientIp(request);
  const rl = rateLimit(`lower-hand:${ip}:${event.id}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = lowerHandSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  await publishControl(event.id, {
    op: 'lowerHand',
    targetEndpointId: parsed.data.targetEndpointId,
    raiseId: parsed.data.raiseId,
    ts: new Date().toISOString(),
  });

  return Response.json({ ok: true });
});
