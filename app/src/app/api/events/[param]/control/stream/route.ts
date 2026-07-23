/**
 * Server-Sent Events stream of transient live-CONTROL signals for an event
 * (F8 raise-hand auto-lower, and any future targeted control op).
 *
 * Deliberately SEPARATE from the chat SSE stream so that:
 *   - it stays open for the WHOLE live session regardless of whether the
 *     chat panel is mounted (chat can be disabled by a moderator — the
 *     lower-hand signal must still reach participants);
 *   - the chat contract is untouched (no ChatEnvelope changes, no risk of
 *     a control envelope rendering as an empty chat bubble).
 *
 * Mirrors the chat stream's framing/keepalive/cleanup exactly; the only
 * difference is the Redis channel (control:<eventId>) and the envelope type.
 * Control ops are fire-and-forget: no `id:`/Last-Event-ID replay (a missed
 * signal is a no-op — the moderator can click again), unlike chat history.
 */

import { prisma } from '@/lib/db';
import { eventParamWhere } from '@/lib/events/event-param';
import { subscribeControl, type ControlEnvelope } from '@/lib/live-control/pubsub';

export const dynamic = 'force-dynamic';
// Keep the stream open for the length of the call (Next.js needs a literal).
export const maxDuration = 3600;

// Keepalive comment every 25s so NGINX's 60s proxy_read_timeout doesn't
// drop the connection while no control signals flow (the common case).
const KEEPALIVE_MS = 25_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ param: string }> },
) {
  const { param } = await context.params;

  const event = await prisma.event.findFirst({
    where: eventParamWhere(param),
    select: { id: true },
  });
  if (!event) {
    return new Response('Event not found', { status: 404 });
  }
  const eventId: string = event.id;

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (envelope: ControlEnvelope) => {
        const payload = `event: message\n` + `data: ${JSON.stringify(envelope)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller already closed (client gone). Ignore.
        }
      };

      // Opener comment so EventSource transitions to OPEN on the first byte.
      controller.enqueue(encoder.encode(`: connected to control:${eventId}\n\n`));

      // Subscribe FIRST; only arm the keepalive once it succeeds, so a Redis
      // subscribe failure can never orphan the interval on a half-open stream.
      try {
        cleanup = await subscribeControl(eventId, send);
      } catch {
        closed();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }
      // If the client already disconnected while we were awaiting the
      // subscription, closed() ran with cleanup still null and couldn't detach.
      // Detach now so the handler doesn't leak on the shared ioredis subscriber.
      if (closedOnce) {
        cleanup();
        cleanup = null;
        return;
      }
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          /* stream closed */
        }
      }, KEEPALIVE_MS);
    },
    cancel() {
      closed();
    },
  });

  // Run cleanup exactly once (both cancel() and 'abort' can fire).
  let closedOnce = false;
  function closed() {
    if (closedOnce) return;
    closedOnce = true;
    if (cleanup) cleanup();
    if (keepalive) clearInterval(keepalive);
  }
  request.signal.addEventListener('abort', closed);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
