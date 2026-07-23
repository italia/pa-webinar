/**
 * Server-Sent Events stream of chat messages for a live event.
 *
 * Clients (see ChatPanel) open this with `new EventSource(url)` and
 * receive a text/event-stream where each chat message is a JSON
 * payload.
 *
 * Why SSE and not WebSocket:
 *   - Native browser support (EventSource), no lib dependency.
 *   - Passes through NGINX ingress without upgrade headers.
 *   - HTTP-level retry/reconnection is automatic; `Last-Event-ID`
 *     plus our `GET /chat/history?since=...` covers late joiner /
 *     reconnect gaps deterministically.
 *   - Chat is a one-way broadcast (server → client) plus a POST
 *     back-channel — a bidirectional WebSocket buys us nothing here.
 *
 * The stream is anchored to a single Redis pub/sub subscription
 * (shared subscriber connection on the pod) — see lib/chat/pubsub.
 * When the client aborts (tab close, nav away) we detect it via the
 * AbortSignal and unsubscribe to prevent listener leaks.
 */

import { extractModeratorToken } from '@/lib/auth/moderator';
import { authorizeChatRead } from '@/lib/chat/read-access';
import { subscribeChat, type ChatEnvelope } from '@/lib/chat/pubsub';
import { errorResponse } from '@/lib/errors';
import { chatSseConnectionsGauge } from '@/lib/metrics';

export const dynamic = 'force-dynamic';
// Opt out of Vercel's default 10s stream budget; we want this open
// for the length of the call. Next.js requires a literal integer
// here (no arithmetic), so 3600 = 1 hour.
export const maxDuration = 3600;

// Idle-keepalive: EventSource considers the connection healthy as
// long as bytes arrive. Send a comment line every 25s so NGINX's
// default proxy_read_timeout (60s) doesn't tear the connection down
// while the room is quiet.
const KEEPALIVE_MS = 25_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ param: string }> },
) {
  const { param } = await context.params;

  // Same gate as GET /chat: this stream is a LIVE feed of attendee names and
  // messages, so it must not be open to anyone holding a slug. EventSource
  // cannot set headers, hence the token arrives as `?token=` here — which
  // extractModeratorToken already accepts alongside the Bearer header.
  //
  // This route builds raw Responses (no withErrorHandling wrapper), so the
  // AppError is mapped through the shared `errorResponse` — same JSON body and
  // status codes as every other route, instead of a hand-rolled mapping that
  // would drift (and that returned a 500 whose body read "Forbidden").
  let eventId: string;
  try {
    ({ eventId } = await authorizeChatRead(param, extractModeratorToken(request)));
  } catch (err) {
    return errorResponse(err);
  }

  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // SSE framing helper. Each message becomes a `data:` block
      // with its JSON payload; the `id:` field gives clients a
      // reconnection checkpoint via Last-Event-ID on retry.
      const send = (envelope: ChatEnvelope) => {
        const payload = `id: ${envelope.id}\n` +
          `event: message\n` +
          `data: ${JSON.stringify(envelope)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Controller already closed (client gone). Ignore.
        }
      };

      // Emit an opener comment immediately so the client knows the
      // connection is established (EventSource transitions to OPEN
      // on the first byte).
      controller.enqueue(encoder.encode(`: connected to chat:${eventId}\n\n`));

      // Keepalive comment line every 25s — pure no-op for the
      // EventSource parser (lines starting with `:` are comments)
      // but enough to keep proxies from timing out.
      keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch { /* stream closed */ }
      }, KEEPALIVE_MS);

      cleanup = await subscribeChat(eventId, send);
      chatSseConnectionsGauge.inc({ event_id: eventId });
    },
    cancel() {
      closed();
    },
  });

  // Single-shot close guard: both ReadableStream.cancel() (when we
  // finish writing or Next.js aborts) and request.signal 'abort'
  // (when the client TCP disconnects) can fire; we want cleanup to
  // run exactly once so the gauge doesn't go negative.
  let closedOnce = false;
  function closed() {
    if (closedOnce) return;
    closedOnce = true;
    if (cleanup) cleanup();
    if (keepalive) clearInterval(keepalive);
    chatSseConnectionsGauge.dec({ event_id: eventId });
  }
  request.signal.addEventListener('abort', closed);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Hint to NGINX ingress to not buffer (would break SSE by
      // holding chunks until the buffer fills).
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  });
}
