/**
 * Internal API for JVB auto-scaling + event lifecycle transitions.
 *
 * Called by the jvb-scaler CronJob every 2 minutes (cluster-internal only,
 * protected by CRON_API_KEY).
 *
 * Responsibilities, in order:
 *
 *   1. Poll JVB /colibri/stats via JVB_HEALTH_URL (best effort).
 *   2. Update event lifecycle state:
 *        PUBLISHED → PROVISIONING   if startsAt within preScaleMinutes
 *                                  (or already started and still PUBLISHED)
 *        PROVISIONING → LIVE        if JVB is reachable AND startsAt ≤ now
 *        LIVE          → refresh    lastActiveAt = now  if bridge has ≥1 participant
 *        LIVE          → IDLE       if lastActiveAt < now - graceMinutes
 *        *             → ENDED      if endsAt < now (terminal)
 *   3. Compute desired JVB + Jibri replica counts from the resulting state.
 *
 * Grace/lookahead windows are read from SiteSetting (admin-configurable),
 * with env fallbacks:
 *     JVB_INACTIVE_GRACE_MIN  → siteSetting.jvbInactiveGraceMinutes (default 45)
 *     JVB_PRE_SCALE_MINUTES   → siteSetting.jvbPreScaleMinutes      (default 10)
 *
 * Scale-to-zero contract: an event in IDLE contributes 0 replicas. Only
 * LIVE and PROVISIONING events count toward desired.
 *
 * Known limitation (MVP): /colibri/stats is aggregate-per-pod, so with
 * multiple LIVE events on the same bridge we can't tell which specific room
 * has traffic. We use the pessimistic rule "if bridge has ≥1 endpoint, all
 * LIVE events are considered active" — acceptable until Octo is introduced.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { jvbsForEvent, jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';

const MAX_REPLICAS = jvbMaxReplicasFromEnv();

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

type JvbStats = {
  participants: number;
  conferences: number;
  stressLevel: number;
  reachable: boolean;
};

async function fetchJvbStats(): Promise<JvbStats> {
  const url = process.env.JVB_HEALTH_URL;
  if (!url) {
    return { participants: 0, conferences: 0, stressLevel: 0, reachable: false };
  }
  try {
    const res = await fetch(`${url}/colibri/stats`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      return { participants: 0, conferences: 0, stressLevel: 0, reachable: false };
    }
    const s = (await res.json()) as Record<string, unknown>;
    return {
      participants: typeof s.participants === 'number' ? s.participants : 0,
      conferences: typeof s.conferences === 'number' ? s.conferences : 0,
      stressLevel: typeof s.stress_level === 'number' ? s.stress_level : 0,
      reachable: true,
    };
  } catch {
    return { participants: 0, conferences: 0, stressLevel: 0, reachable: false };
  }
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const settings = await getSettings();
  const inactiveGraceMin =
    settings.jvbInactiveGraceMinutes ??
    parseInt(process.env.JVB_INACTIVE_GRACE_MIN || '45', 10);
  const preScaleMin =
    settings.jvbPreScaleMinutes ??
    parseInt(process.env.JVB_PRE_SCALE_MINUTES || '10', 10);
  // Reactive scale-up thresholds, 0-100 percent. Stored as integer in DB
  // for the admin form; compared against the 0..1 fraction from JVB stats.
  const stressWarn = clampPct(settings.jvbStressWarnPercent ?? 50) / 100;
  const stressCritical = clampPct(settings.jvbStressCriticalPercent ?? 70) / 100;

  const now = new Date();
  const preScaleWindow = new Date(now.getTime() + preScaleMin * 60_000);
  const inactiveCutoff = new Date(now.getTime() - inactiveGraceMin * 60_000);

  const jvb = await fetchJvbStats();

  // Phase 2 — stress from query string is a legacy caller signal; keep
  // it as a hint but prefer our own polling.
  const stressParam = new URL(request.url).searchParams.get('stress_level');
  const stressFromCaller = stressParam ? parseFloat(stressParam) : null;
  const effectiveStress = jvb.reachable ? jvb.stressLevel : stressFromCaller ?? 0;

  // ── Lifecycle transitions (applied as an atomic batch) ───────────
  // Order matters: first refresh LIVE activity, then demote stale LIVE→IDLE,
  // then terminal ENDED, then schedule/promote new events.
  const transitions = await prisma.$transaction(async (tx) => {
    const counts = {
      liveRefreshed: 0,
      liveToIdle: 0,
      toEnded: 0,
      publishedToProvisioning: 0,
      provisioningToLive: 0,
    };

    // 1) Refresh lastActiveAt for LIVE events when bridge has traffic.
    if (jvb.reachable && jvb.participants > 0) {
      const r = await tx.event.updateMany({
        where: { status: 'LIVE' },
        data: { lastActiveAt: now },
      });
      counts.liveRefreshed = r.count;
    }

    // 2) LIVE → IDLE when the conference has been empty for ≥ grace.
    //    Use lastActiveAt when set, else fall back to provisioningStartedAt
    //    (for events that went LIVE but never had anyone join).
    const idleCandidates = await tx.event.findMany({
      where: {
        status: 'LIVE',
        endsAt: { gt: now },
        OR: [
          { lastActiveAt: { lt: inactiveCutoff } },
          { AND: [{ lastActiveAt: null }, { provisioningStartedAt: { lt: inactiveCutoff } }] },
        ],
      },
      select: { id: true },
    });
    if (idleCandidates.length > 0) {
      const r = await tx.event.updateMany({
        where: { id: { in: idleCandidates.map((e) => e.id) } },
        data: { status: 'IDLE' },
      });
      counts.liveToIdle = r.count;
    }

    // 3) Any non-terminal event past endsAt → ENDED.
    const r3 = await tx.event.updateMany({
      where: {
        status: { in: ['PUBLISHED', 'PROVISIONING', 'LIVE', 'IDLE'] },
        endsAt: { lt: now },
      },
      data: { status: 'ENDED' },
    });
    counts.toEnded = r3.count;

    // 4) PUBLISHED → PROVISIONING when startsAt enters the pre-scale window,
    //    or when startsAt has already passed and nobody moved the state yet.
    const r4 = await tx.event.updateMany({
      where: {
        status: 'PUBLISHED',
        startsAt: { lte: preScaleWindow },
        endsAt: { gt: now },
      },
      data: { status: 'PROVISIONING', provisioningStartedAt: now },
    });
    counts.publishedToProvisioning = r4.count;

    // 5) PROVISIONING → LIVE when the bridge is up AND the event has started.
    //    We wait on bridge reachability so the first joining user doesn't
    //    land on a still-cold JVB.
    if (jvb.reachable) {
      const r5 = await tx.event.updateMany({
        where: {
          status: 'PROVISIONING',
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        data: { status: 'LIVE' },
      });
      counts.provisioningToLive = r5.count;
    }

    return counts;
  });

  // ── Compute desired replicas from the updated state ──────────────
  const billableEvents = await prisma.event.findMany({
    where: {
      status: { in: ['LIVE', 'PROVISIONING'] },
      endsAt: { gt: now },
    },
    select: {
      id: true,
      maxParticipants: true,
      participantsCanStartVideo: true,
      recordingEnabled: true,
      status: true,
    },
  });

  let predictiveDesired = 0;
  const breakdown = billableEvents.map((event) => {
    const jvbs = jvbsForEvent(event.maxParticipants, event.participantsCanStartVideo);
    predictiveDesired += jvbs;
    return {
      eventId: event.id,
      status: event.status,
      maxParticipants: event.maxParticipants,
      videoEnabled: event.participantsCanStartVideo,
      jvbs,
    };
  });

  // Reactive: if measured stress is high, add headroom. Thresholds come
  // from SiteSetting so an admin can make the scaler more or less eager
  // without a redeploy.
  let reactiveAdjustment = 0;
  if (effectiveStress > stressCritical) reactiveAdjustment = 2;
  else if (effectiveStress > stressWarn) reactiveAdjustment = 1;

  const desired = Math.min(
    Math.max(predictiveDesired + reactiveAdjustment, billableEvents.length > 0 ? 1 : 0),
    MAX_REPLICAS,
  );

  // Jibri: 1 replica only if a currently-billable event has recording on.
  const needsRecording = billableEvents.some((e) => e.recordingEnabled);
  const jibriDesired = needsRecording ? 1 : 0;

  return Response.json({
    desired,
    jibriDesired,
    predictiveDesired,
    reactiveAdjustment,
    stressLevel: effectiveStress,
    jvbReachable: jvb.reachable,
    jvbParticipants: jvb.participants,
    activeEvents: billableEvents.length,
    breakdown,
    transitions,
    inactiveGraceMinutes: inactiveGraceMin,
    preScaleMinutes: preScaleMin,
    stressWarnPercent: Math.round(stressWarn * 100),
    stressCriticalPercent: Math.round(stressCritical * 100),
    maxReplicas: MAX_REPLICAS,
    checkedAt: now.toISOString(),
  });
});
