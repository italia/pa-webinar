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
import { shouldEndLiveEvent } from '@/lib/events/lifecycle';
import {
  JVB_SNAPSHOT_KEY,
  JVB_SNAPSHOT_TTL_SECONDS,
  type JvbSnapshot,
} from '@/lib/jvb-snapshot';
import { jvbsForEvent, jvbMaxReplicasFromEnv } from '@/lib/jvb-sizing';
import { getRedis } from '@/lib/redis';
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

  const searchParams = new URL(request.url).searchParams;
  const numParam = (name: string): number | null => {
    const v = searchParams.get(name);
    if (v === null) return null;
    const p = Number(v);
    return Number.isFinite(p) ? p : null;
  };

  // The scaler (CronJob) has K8s RBAC to read the deployment; it forwards
  // `current` (spec.replicas) and `ready` (status.readyReplicas) so we can
  // persist an authoritative snapshot for the public status page. Parse
  // defensively: if the caller is an older scaler image, fall back to null.
  const currentReplicas = numParam('current') !== null ? Math.trunc(numParam('current')!) : null;
  const readyReplicas = numParam('ready') !== null ? Math.trunc(numParam('ready')!) : null;

  // The scaler also aggregates `/colibri/stats` across ALL JVB pods (it has
  // `pods/exec` RBAC). A single Service-LB fetch from this pod would only
  // see one random bridge's slice of the traffic, which broke status-page
  // numbers whenever `ready > 1`. `pollSuccesses > 0` is the signal that
  // the scaler ran aggregation this tick; absent (older scaler image, or
  // kubectl-exec failed for all pods) we fall back to a single fetch.
  const pollSuccesses = numParam('pollSuccesses');
  const pollFailures = numParam('pollFailures');
  const scalerAggregated = pollSuccesses !== null && pollSuccesses > 0;

  const stressFromCaller = numParam('stress_level');
  const jvb = scalerAggregated
    ? { participants: 0, conferences: 0, stressLevel: 0, reachable: false }
    : await fetchJvbStats();

  const participants = scalerAggregated
    ? numParam('participants') ?? 0
    : jvb.participants;
  const conferences = scalerAggregated
    ? numParam('conferences') ?? 0
    : jvb.conferences;
  const effectiveStress = scalerAggregated
    ? numParam('stressLevel') ?? 0
    : jvb.reachable
      ? jvb.stressLevel
      : stressFromCaller ?? 0;
  // Aggregation succeeded ⇒ at least one pod answered ⇒ bridge is reachable.
  // Without aggregation we can only use the single-pod probe's reachable flag.
  const jvbReachable = scalerAggregated ? true : jvb.reachable;

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
    if (jvbReachable && participants > 0) {
      const r = await tx.event.updateMany({
        where: { status: 'LIVE' },
        data: { lastActiveAt: now },
      });
      counts.liveRefreshed = r.count;
    }

    // 2) LIVE → IDLE when the conference has been empty for ≥ grace.
    //    Use lastActiveAt when set, else fall back to provisioningStartedAt
    //    (for events that went LIVE but never had anyone join).
    //
    //    Safety guard: /colibri/stats is served by whichever JVB pod the
    //    Service VIP routes to on this tick. With multiple replicas (a
    //    second event scales the deployment out) the probe might land on
    //    a freshly-spun-up empty pod while the real traffic lives on a
    //    sibling — making `participants=0` meaningless for LIVE-ness.
    //    When currentReplicas > 1 we therefore skip the entire demotion
    //    step for this tick; operator-visible staleness still surfaces
    //    via the provisioning-timeout path, and real idleness is caught
    //    once the deployment scales back down to 1.
    //
    //    When the scaler provided aggregated cross-pod stats this tick, the
    //    `participants` count above is correct for every replica and the
    //    guard can be dropped.
    const skipIdleDemotion = !scalerAggregated && (currentReplicas ?? 1) > 1;
    if (!skipIdleDemotion) {
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
    }

    // 3) Past endsAt:
    //    - PUBLISHED / PROVISIONING / IDLE past endsAt → ENDED (they
    //      never really served anyone; nothing to grace).
    //    - LIVE past endsAt respects the grace period: the event gets
    //      a soft "overtime" window, then we flip to ENDED. Grace
    //      of -1 means "never auto-close" — the inactivity cleanup in
    //      step (2) will eventually catch it.
    const r3a = await tx.event.updateMany({
      where: {
        status: { in: ['PUBLISHED', 'PROVISIONING', 'IDLE'] },
        endsAt: { lt: now },
      },
      data: { status: 'ENDED' },
    });
    counts.toEnded = r3a.count;

    const liveOvertime = await tx.event.findMany({
      where: { status: 'LIVE', endsAt: { lt: now } },
      select: { id: true, endsAt: true, gracePeriodMinutes: true },
    });
    const siteGrace = settings.eventGracePeriodMinutes ?? 15;
    const toEndIds: string[] = [];
    for (const ev of liveOvertime) {
      if (shouldEndLiveEvent({
        endsAt: ev.endsAt,
        gracePeriodMinutes: ev.gracePeriodMinutes,
        siteGraceMinutes: siteGrace,
        now,
      })) {
        toEndIds.push(ev.id);
      }
    }
    if (toEndIds.length > 0) {
      const r3b = await tx.event.updateMany({
        where: { id: { in: toEndIds } },
        data: { status: 'ENDED' },
      });
      counts.toEnded += r3b.count;
    }

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
    if (jvbReachable) {
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
  // LIVE events within endsAt+grace are still billable. Step (3) above
  // has already flipped past-grace LIVE → ENDED, so whatever remains
  // LIVE/PROVISIONING here actually needs bridge capacity.
  const billableEvents = await prisma.event.findMany({
    where: { status: { in: ['LIVE', 'PROVISIONING'] } },
    select: {
      id: true,
      maxParticipants: true,
      expectedSenderRatioPct: true,
      participantsCanStartVideo: true,
      recordingEnabled: true,
      status: true,
      endsAt: true,
      gracePeriodMinutes: true,
    },
  });

  const sizingConfig = {
    cpuCoresPerPod: settings.jvbCpuCoresPerPod ?? 16,
    receiversPerCore: settings.jvbReceiversPerCore ?? 18.75,
    sendersPerCore: settings.jvbSendersPerCore ?? 3.125,
    maxReplicas: settings.jvbMaxReplicas ?? MAX_REPLICAS,
  };
  const defaultSenderRatio = settings.defaultSenderRatioPct ?? 30;

  let predictiveDesired = 0;
  const breakdown = billableEvents.map((event) => {
    const ratio = event.expectedSenderRatioPct ?? defaultSenderRatio;
    const jvbs = jvbsForEvent(
      event.maxParticipants,
      ratio,
      event.participantsCanStartVideo,
      sizingConfig,
    );
    predictiveDesired += jvbs;
    const inOvertime = event.status === 'LIVE' && event.endsAt.getTime() < now.getTime();
    return {
      eventId: event.id,
      status: event.status,
      maxParticipants: event.maxParticipants,
      senderRatio: ratio,
      videoEnabled: event.participantsCanStartVideo,
      jvbs,
      inOvertime,
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

  // Forensic log line: one structured summary per tick so we can
  // reconstruct which events moved between states and why (replica
  // churn during overlapping live events has been a source of
  // hard-to-reproduce bugs).
  const hasTransitions =
    transitions.liveRefreshed > 0 ||
    transitions.liveToIdle > 0 ||
    transitions.toEnded > 0 ||
    transitions.publishedToProvisioning > 0 ||
    transitions.provisioningToLive > 0;
  if (hasTransitions || billableEvents.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[jvb-scaler] tick ${now.toISOString()} ` +
        `current=${currentReplicas ?? '?'} ready=${readyReplicas ?? '?'} ` +
        `desired=${desired} billable=${billableEvents.length} ` +
        `stress=${effectiveStress.toFixed(2)} jvbReachable=${jvbReachable} ` +
        `jvbParticipants=${participants} conferences=${conferences} ` +
        `aggregated=${scalerAggregated} pollSuccesses=${pollSuccesses ?? 0} ` +
        `pollFailures=${pollFailures ?? 0} ` +
        `transitions=${JSON.stringify(transitions)}`,
    );
  }

  // Persist snapshot for /api/status. Only write when the caller provided
  // the replica counts — otherwise we'd overwrite a valid snapshot with a
  // partial one. Redis is optional in dev, so swallow errors silently.
  if (currentReplicas !== null && readyReplicas !== null) {
    const redis = getRedis();
    if (redis) {
      const snapshot: JvbSnapshot = {
        current: currentReplicas,
        ready: readyReplicas,
        desired,
        checkedAt: now.toISOString(),
      };
      if (scalerAggregated) {
        // Aggregated snapshot — authoritative traffic figures for the
        // public status page. Fields are written only when the scaler
        // provided them so a partial aggregation (e.g. some pods probed
        // successfully, some failed) still stores meaningful sums.
        snapshot.pollSuccesses = pollSuccesses ?? undefined;
        snapshot.pollFailures = pollFailures ?? undefined;
        snapshot.participants = participants;
        snapshot.conferences = conferences;
        snapshot.stressLevel = effectiveStress;
        const largest = numParam('largestConference');
        if (largest !== null) snapshot.largestConference = largest;
        const audio = numParam('endpointsSendingAudio');
        if (audio !== null) snapshot.endpointsSendingAudio = audio;
        const video = numParam('endpointsSendingVideo');
        if (video !== null) snapshot.endpointsSendingVideo = video;
        const bitDown = numParam('bitRateDownKbps');
        if (bitDown !== null) snapshot.bitRateDownKbps = bitDown;
        const bitUp = numParam('bitRateUpKbps');
        if (bitUp !== null) snapshot.bitRateUpKbps = bitUp;
        const octoC = numParam('octoConferences');
        if (octoC !== null) snapshot.octoConferences = octoC;
        const octoE = numParam('octoEndpoints');
        if (octoE !== null) snapshot.octoEndpoints = octoE;
        const octoSend = numParam('octoSendBitrateBps');
        if (octoSend !== null) snapshot.octoSendBitrateBps = octoSend;
        const octoRecv = numParam('octoReceiveBitrateBps');
        if (octoRecv !== null) snapshot.octoReceiveBitrateBps = octoRecv;
      }
      try {
        await redis.set(
          JVB_SNAPSHOT_KEY,
          JSON.stringify(snapshot),
          'EX',
          JVB_SNAPSHOT_TTL_SECONDS,
        );
      } catch {
        // Non-fatal: scaler still completes its primary job of scaling.
      }
    }
  }

  return Response.json({
    desired,
    jibriDesired,
    predictiveDesired,
    reactiveAdjustment,
    stressLevel: effectiveStress,
    jvbReachable,
    jvbParticipants: participants,
    activeEvents: billableEvents.length,
    breakdown,
    transitions,
    inactiveGraceMinutes: inactiveGraceMin,
    preScaleMinutes: preScaleMin,
    stressWarnPercent: Math.round(stressWarn * 100),
    stressCriticalPercent: Math.round(stressCritical * 100),
    maxReplicas: MAX_REPLICAS,
    currentReplicas,
    readyReplicas,
    checkedAt: now.toISOString(),
  });
});
