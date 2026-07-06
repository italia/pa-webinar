/**
 * GET /api/events/[slug]/lifecycle
 *
 * Lightweight, no-auth endpoint polled by the ProvisioningScreen while it
 * waits for the JVB to come up. Returns only what the UI needs to decide
 * whether to keep waiting or redirect into the Jitsi room.
 *
 * Not rate limited: the poll runs at ~5s from a single open tab, and the
 * response is cheap.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { readJvbSnapshot } from '@/lib/jvb-snapshot';

export const dynamic = 'force-dynamic';

/**
 * Fase del warm-up del media plane, derivata dallo snapshot Redis che lo
 * scaler scrive a ogni tick (2 min). Serve alla sala d'attesa per dare
 * all'utente una stima ONESTA invece dello spinner cieco:
 *   - queued: lo scaler non ha ancora preso in carico (tick entro 2 min)
 *   - starting: repliche richieste, nessuna Ready — pod in schedule o
 *     nodo del pool video in creazione (il caso lungo, ~3-5 min a freddo)
 *   - ready: almeno un bridge Ready — lo status passa a LIVE al prossimo
 *     giro di scaler/joiner
 */
function jvbPhase(snapshot: Awaited<ReturnType<typeof readJvbSnapshot>>) {
  if (!snapshot) return 'queued';
  if (snapshot.ready > 0) return 'ready';
  if (snapshot.desired > 0) return 'starting';
  return 'queued';
}

export const GET = withErrorHandling(async (_request, context) => {
  const { param: slug } = await context.params;

  const event = await prisma.event.findUnique({
    where: { slug },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      provisioningStartedAt: true,
      lastActiveAt: true,
    },
  });

  if (!event) throw new NotFoundError('Event');

  // Lo snapshot serve solo mentre si aspetta il bridge: fuori dal warm-up
  // evitiamo la lettura Redis su ogni poll.
  const warming = event.status === 'IDLE' || event.status === 'PROVISIONING';
  const snapshot = warming ? await readJvbSnapshot() : null;

  return Response.json(
    {
      status: event.status,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      provisioningStartedAt: event.provisioningStartedAt?.toISOString() ?? null,
      lastActiveAt: event.lastActiveAt?.toISOString() ?? null,
      serverTime: new Date().toISOString(),
      ...(warming && {
        jvb: {
          phase: jvbPhase(snapshot),
          ready: snapshot?.ready ?? 0,
          desired: snapshot?.desired ?? 0,
          checkedAt: snapshot?.checkedAt ?? null,
        },
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
