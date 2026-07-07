/**
 * GET /api/events/[slug]/lifecycle
 *
 * Lightweight, no-auth endpoint polled by the waiting room (~3s per open
 * tab) while it waits for the JVB to come up. Returns only what the UI
 * needs to decide whether to keep waiting or redirect into the Jitsi room,
 * plus honest warm-up telemetry (phase + stopwatch anchor).
 *
 * Not rate limited, but the Redis snapshot read is collapsed behind a short
 * process-local cache (see cachedSnapshot) so many concurrent waiters don't
 * each hit Redis for a value the scaler rewrites only every ~2 min.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { readJvbSnapshot, type JvbSnapshot } from '@/lib/jvb-snapshot';

export const dynamic = 'force-dynamic';

// A pre-warmed bridge can be Ready up to preScaleMinutes (30) before a
// scheduled start; provisioningStartedAt also lingers a full cycle after the
// scaler demotes LIVE→IDLE. Cap the stopwatch anchor so a stale timestamp
// can't drive an hours-long "elapsed" — a cold node pool is ~3-5 min.
const WARMUP_ANCHOR_MAX_MS = 15 * 60_000;

// Process-local micro-cache: the snapshot is a single global Redis key the
// scaler rewrites every ~2 min, but every waiting client polls every 3s.
// A 2s TTL collapses concurrent reads into one Redis round-trip.
let snapshotCache: { at: number; snap: JvbSnapshot | null } | null = null;
const SNAPSHOT_CACHE_TTL_MS = 2000;

async function cachedSnapshot(nowMs: number): Promise<JvbSnapshot | null> {
  if (snapshotCache && nowMs - snapshotCache.at < SNAPSHOT_CACHE_TTL_MS) {
    return snapshotCache.snap;
  }
  const snap = await readJvbSnapshot();
  snapshotCache = { at: nowMs, snap };
  return snap;
}

/**
 * Fase del warm-up del media plane, derivata dallo snapshot Redis che lo
 * scaler scrive a ogni tick (2 min). Serve alla sala d'attesa per dare
 * all'utente una stima ONESTA invece dello spinner cieco:
 *   - queued: lo scaler non ha ancora preso in carico (tick entro 2 min)
 *   - starting: repliche richieste, nessuna Ready — pod in schedule o
 *     nodo del pool video in creazione (il caso lungo, ~3-5 min a freddo)
 *   - ready: almeno un bridge Ready E l'orario d'inizio è passato — lo
 *     status passa a LIVE al prossimo giro di scaler/joiner. Un evento
 *     schedulato pre-scaldato resta 'starting' finché non scatta l'orario:
 *     il bridge è su ma l'utente non può ancora entrare, dire "ci siamo
 *     quasi" per 30 min sarebbe una bugia.
 */
function jvbPhase(
  snapshot: JvbSnapshot | null,
  startsInFuture: boolean,
): 'queued' | 'starting' | 'ready' {
  if (!snapshot) return 'queued';
  if (snapshot.ready > 0 && !startsInFuture) return 'ready';
  if (snapshot.desired > 0 || snapshot.ready > 0) return 'starting';
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

  const nowMs = Date.now();
  const startsInFuture = event.startsAt.getTime() > nowMs;

  // Lo snapshot serve solo mentre si aspetta il bridge: fuori dal warm-up
  // evitiamo la lettura Redis su ogni poll.
  const warming = event.status === 'IDLE' || event.status === 'PROVISIONING';
  const snapshot = warming ? await cachedSnapshot(nowMs) : null;

  // Ancora del cronometro: solo mentre PROVISIONING (il flip di /wake scrive
  // provisioningStartedAt=now) e solo se recente. In IDLE il timestamp è un
  // residuo del ciclo precedente (lo scaler LIVE→IDLE tocca solo lo status):
  // esporlo farebbe partire un cronometro da ore.
  const provMs = event.provisioningStartedAt?.getTime() ?? null;
  const warmupStartedAt =
    event.status === 'PROVISIONING' &&
    provMs !== null &&
    nowMs - provMs < WARMUP_ANCHOR_MAX_MS
      ? event.provisioningStartedAt!.toISOString()
      : null;

  return Response.json(
    {
      status: event.status,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      provisioningStartedAt: event.provisioningStartedAt?.toISOString() ?? null,
      lastActiveAt: event.lastActiveAt?.toISOString() ?? null,
      serverTime: new Date(nowMs).toISOString(),
      ...(warming && {
        jvb: {
          phase: jvbPhase(snapshot, startsInFuture),
          startedAt: warmupStartedAt,
          ready: snapshot?.ready ?? 0,
          desired: snapshot?.desired ?? 0,
          checkedAt: snapshot?.checkedAt ?? null,
        },
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});
