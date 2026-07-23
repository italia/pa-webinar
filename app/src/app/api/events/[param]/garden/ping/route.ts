/**
 * POST /api/events/:slug/garden/ping
 *
 * Called by the waiting-room garden client a few times per second
 * (throttled on the client at ~5 Hz) to advertise the user's
 * position and receive the current snapshot of peers. The server
 *
 *   1. validates that the event is in a state where the garden is
 *      meaningful (PUBLISHED / PROVISIONING / LIVE — not ENDED);
 *   2. writes the peer to Redis (`garden:<eventId>:pos`) with TTL;
 *   3. publishes on `garden:<eventId>` so subscribers of the SSE
 *      stream see the update;
 *   4. returns the current list of peers so the client also gets a
 *      ~200 ms-fresh snapshot even if the SSE is briefly behind.
 *
 * No auth: anyone on the live page can ping, rate-limited per IP.
 * Not persistent: positions live only in Redis for 10 s.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { AppError, NotFoundError, RateLimitError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import {
  listGardenPeers,
  publishGardenPing,
  removeGardenPeer,
  type GardenPeer,
} from '@/lib/garden/pubsub';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pingSchema = z.object({
  userId: z.string().min(8).max(48),
  displayName: z.string().min(1).max(80),
  avatarId: z.string().min(1).max(16),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  facing: z.enum(['down', 'up', 'left', 'right']),
  walkPhase: z.number().min(0).max(1),
  /**
   * Emote transiente (saluto / cuore). `.optional()` NON è pigrizia: i client
   * già in giro non mandano il campo e devono continuare a pingare senza
   * beccarsi un 400. Il server fa solo da ripetitore — `at` è l'orologio del
   * mittente e serve al ricevente per deduplicare (vedi GardenPeer.emote).
   */
  emote: z
    .object({
      type: z.enum(['wave', 'heart']),
      at: z.number().int().nonnegative(),
    })
    .optional(),
  /** When true the server removes the peer — used on "Leave garden". */
  leave: z.boolean().optional(),
});

export const POST = withErrorHandling(async (request, context) => {
  const { param } = await context.params;

  const ip = getClientIp(request);
  // Generous cap: ~5 Hz × 60 s = 300 pings/min. Well above what a
  // well-behaved client sends; catches runaway loops.
  const rl = rateLimit(`garden-ping:${ip}`, { limit: 600, windowMs: 60_000 });
  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = pingSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError('Invalid ping', 400, 'BAD_REQUEST');
  }

  const isUuid = UUID_RE.test(param);
  const event = await prisma.event.findFirst({
    where: isUuid ? { OR: [{ id: param }, { slug: param }] } : { slug: param },
    select: { id: true, status: true },
  });
  if (!event) throw new NotFoundError('Event');

  // Garden is only meaningful before/during the live call. After
  // ENDED there's nothing to wait for — reject silently so stragglers
  // don't keep writing.
  if (event.status === 'ENDED' || event.status === 'DRAFT' || event.status === 'IDLE') {
    return NextResponse.json({ peers: [], active: false });
  }

  if (parsed.data.leave) {
    await removeGardenPeer(event.id, parsed.data.userId);
    return NextResponse.json({ peers: [], active: true, left: true });
  }

  const peer: GardenPeer = {
    userId: parsed.data.userId,
    displayName: parsed.data.displayName.slice(0, 80),
    avatarId: parsed.data.avatarId,
    x: parsed.data.x,
    y: parsed.data.y,
    facing: parsed.data.facing,
    walkPhase: parsed.data.walkPhase,
    updatedAt: Date.now(),
    // Presente solo quando il client la manda: mettere `emote: undefined` la
    // farebbe sparire comunque nel JSON, ma così il record Redis resta
    // identico a prima per i client che non emotano.
    ...(parsed.data.emote ? { emote: parsed.data.emote } : {}),
  };

  await publishGardenPing(event.id, peer);
  const peers = await listGardenPeers(event.id);

  return NextResponse.json({ peers, active: true });
});
