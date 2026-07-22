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
import {
  shouldDemoteLiveToIdle,
  shouldEndLiveEvent,
  shouldReclaimEmptyOvertime,
  emptyCloseCutoff,
} from '@/lib/events/lifecycle';
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
  // Authoritative empty-conference close (feedback #12). Minutes a LIVE room
  // that HAD traffic may stay COMPLETELY empty (moderator included) before we
  // flip it straight to ENDED — terminal, distinct from the scale-to-zero
  // inactivity grace. DISABLED by default (-1); opt-in admin setting only,
  // because a terminal close on a stale participants=0 reading would eject a
  // still-populated room. The column is NOT NULL so the env fallback only
  // guards a hypothetical null (unreachable on a provisioned singleton).
  const emptyCloseMin =
    settings.jvbEmptyCloseMinutes ??
    parseInt(process.env.JVB_EMPTY_CLOSE_MIN || '-1', 10);
  // Reactive scale-up thresholds, 0-100 percent. Stored as integer in DB
  // for the admin form; compared against the 0..1 fraction from JVB stats.
  const stressWarn = clampPct(settings.jvbStressWarnPercent ?? 50) / 100;
  const stressCritical = clampPct(settings.jvbStressCriticalPercent ?? 70) / 100;

  const now = new Date();
  const preScaleWindow = new Date(now.getTime() + preScaleMin * 60_000);
  const inactiveCutoff = new Date(now.getTime() - inactiveGraceMin * 60_000);
  const emptyCloseCut = emptyCloseCutoff(now, emptyCloseMin);

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
      liveEmptyClosed: 0,
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

    // Shared reliability guard for participant-count-driven demotion/close.
    // /colibri/stats is served by whichever JVB pod the Service VIP routes to
    // on this tick; with >1 replica and no cross-pod aggregation a
    // `participants=0` reading is unreliable (the probe may hit a fresh empty
    // sibling while real traffic lives on another), so we skip BOTH the
    // empty-close AND the IDLE demotion this tick. When the scaler provided
    // aggregated cross-pod stats the count is correct and the guard is dropped.
    const skipIdleDemotion = !scalerAggregated && (currentReplicas ?? 1) > 1;

    // 1b) LIVE → ENDED — authoritative empty-conference close (feedback #12).
    //     Runs BEFORE the IDLE demotion so, when both would match, ENDED wins
    //     (terminal) over IDLE (revivable). Fires only for rooms that HAD
    //     traffic then emptied: lastActiveAt non-null AND older than the
    //     admin-tunable cutoff, with endsAt still in the future (an EARLY
    //     close; past-endsAt LIVE rooms are handled by the grace path below).
    //     DISABLED by default (jvbEmptyCloseMinutes = -1 → emptyCloseCut null);
    //     opt-in only. Because it keys on `participants=0` it fires only when
    //     EVERYONE — moderator included — has left (a moderated break where the
    //     host keeps the tab open never triggers it). Still a known residual: a
    //     sustained stale participants=0 (degraded /colibri/stats) could close a
    //     populated room, which is why it stays off by default.
    //     `jvbReachable` is required: a terminal close must never fire on a
    //     stale reading during a bridge blip — stricter than the IDLE path on
    //     purpose, since ENDED is NOT auto-revived on rejoin (only IDLE is, via
    //     /wake). Honours the same multi-replica skipIdleDemotion guard.
    if (!skipIdleDemotion && emptyCloseCut && jvbReachable) {
      const emptyCloseCandidates = await tx.event.findMany({
        where: {
          status: 'LIVE',
          endsAt: { gt: now },
          lastActiveAt: { not: null, lt: emptyCloseCut },
        },
        select: { id: true },
      });
      if (emptyCloseCandidates.length > 0) {
        const closedIds = emptyCloseCandidates.map((e) => e.id);
        const r = await tx.event.updateMany({
          where: { id: { in: closedIds } },
          data: { status: 'ENDED' },
        });
        counts.liveEmptyClosed = r.count;
        await closeOpenSessions(tx, closedIds, now);
      }
    }

    // 2) LIVE → IDLE when the conference has been empty for ≥ grace.
    //    Use lastActiveAt when set, else fall back to provisioningStartedAt
    //    (for events that went LIVE but never had anyone join). Uses the shared
    //    skipIdleDemotion guard computed above (multi-replica staleness).
    //    NOTE: this is a REVIVABLE, future-endsAt demotion, so it intentionally
    //    uses simpler empty-detection than the terminal past-endsAt reclaim in
    //    step 3b (shouldReclaimEmptyOvertime), which adds max-of-signals +
    //    endsAt fallback + a stricter reliability gate BECAUSE it closes to
    //    ENDED. The two are deliberately NOT the same predicate — don't unify.
    if (!skipIdleDemotion) {
      // Fetch the LIVE-before-endsAt set and decide in `shouldDemoteLiveToIdle`,
      // rather than encoding the rule as a WHERE clause: the rule needs the
      // LATEST of several timestamps (SQL would need GREATEST, which Prisma
      // cannot express here) and it is worth unit-testing on its own. The set is
      // at most a handful of rows.
      const liveEvents = await tx.event.findMany({
        where: { status: 'LIVE', endsAt: { gt: now } },
        select: {
          id: true,
          lastActiveAt: true,
          provisioningStartedAt: true,
          startsAt: true,
        },
      });
      const idleCandidates = liveEvents.filter((e) =>
        shouldDemoteLiveToIdle({
          lastActiveAt: e.lastActiveAt,
          provisioningStartedAt: e.provisioningStartedAt,
          startsAt: e.startsAt,
          inactiveCutoff,
        }),
      );
      if (idleCandidates.length > 0) {
        const demotedIds = idleCandidates.map((e) => e.id);
        const r = await tx.event.updateMany({
          where: { id: { in: demotedIds } },
          data: { status: 'IDLE' },
        });
        counts.liveToIdle = r.count;
        // Close any CallSession still open on these events. The client
        // opened them on first `videoConferenceJoined`; we never know
        // exactly when the last participant disconnected, so we use
        // `now` (capped by `endsAt` when set — see below) as the close
        // time. Tradeoff: a bit of extra "duration" equal to the 45-min
        // inactivity grace, acceptable for post-event analytics.
        await closeOpenSessions(tx, demotedIds, now);
      }
    }

    // 3) Past endsAt:
    //    - PUBLISHED / PROVISIONING / IDLE past endsAt → ENDED (they
    //      never really served anyone; nothing to grace).
    //    - LIVE past endsAt respects the grace period: the event gets
    //      a soft "overtime" window, then we flip to ENDED. Grace
    //      of -1 means "never auto-close" — the inactivity cleanup in
    //      step (2) will eventually catch it.
    const endedByTimeoutCandidates = await tx.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'PROVISIONING', 'IDLE'] },
        endsAt: { lt: now },
      },
      select: { id: true },
    });
    const r3a = await tx.event.updateMany({
      where: { id: { in: endedByTimeoutCandidates.map((e) => e.id) } },
      data: { status: 'ENDED' },
    });
    counts.toEnded = r3a.count;
    if (endedByTimeoutCandidates.length > 0) {
      await closeOpenSessions(tx, endedByTimeoutCandidates.map((e) => e.id), now);
    }

    const liveOvertime = await tx.event.findMany({
      where: { status: 'LIVE', endsAt: { lt: now } },
      select: {
        id: true,
        endsAt: true,
        gracePeriodMinutes: true,
        lastActiveAt: true,
        provisioningStartedAt: true,
      },
    });
    const siteGrace = settings.eventGracePeriodMinutes ?? 15;
    // A LIVE room past endsAt ends when EITHER of two things is true:
    //   (a) its grace window elapsed (shouldEndLiveEvent) — a time-based close
    //       that fires regardless of who's present, including grace=0/N; OR
    //   (b) it has sat EMPTY for the inactivity grace (shouldReclaimEmptyOvertime)
    //       — this reclaims the JVB even under grace=-1 ("never auto-close"), so
    //       an open-ended call people forgot to close doesn't pin a bridge
    //       forever. Step (2) above only demotes EMPTY rooms whose endsAt is
    //       still in the FUTURE; without (b) an emptied OVERTIME room with
    //       grace=-1 matched no branch at all and leaked a JVB node indefinitely.
    // A past-endsAt LIVE room ends on EITHER the time-based grace close
    // (shouldEndLiveEvent, ungated — it never looks at the count) OR, for
    // OPEN-ENDED rooms only, once it has sat empty for the inactivity grace
    // (shouldReclaimEmptyOvertime — see its JSDoc for the full rationale:
    // grace<0-only scope, MAX-of-signals /wake-race safety, co-hosted-bridge
    // caveat, and why terminal ENDED is safe past endsAt).
    //
    // canReclaimEmpty gates the empty path: before we TERMINALLY close on
    // participants=0 the reading must be POSITIVELY known reliable — cross-pod
    // aggregated, or an explicitly-reported single replica. This is STRICTER
    // than step 2's `!skipIdleDemotion` guard (which only drops the unreliable
    // multi-replica-without-aggregation case): an older scaler image that omits
    // `current` (currentReplicas=null, assumed 1) passes !skipIdleDemotion but
    // NOT this, so it can't terminally evict an occupied call off a single-pod
    // probe. countReliableForClose already implies !skipIdleDemotion, so the
    // latter is intentionally omitted here as redundant. The grace close needs
    // none of this — it never looks at the count.
    const countReliableForClose = scalerAggregated || currentReplicas === 1;
    const canReclaimEmpty = jvbReachable && countReliableForClose;
    const toEndIds: string[] = [];
    for (const ev of liveOvertime) {
      const graceClose = shouldEndLiveEvent({
        endsAt: ev.endsAt,
        gracePeriodMinutes: ev.gracePeriodMinutes,
        siteGraceMinutes: siteGrace,
        now,
      });
      const emptyReclaim = shouldReclaimEmptyOvertime({
        gracePeriodMinutes: ev.gracePeriodMinutes,
        siteGraceMinutes: siteGrace,
        lastActiveAt: ev.lastActiveAt,
        provisioningStartedAt: ev.provisioningStartedAt,
        endsAt: ev.endsAt,
        inactiveCutoff,
        canReclaimEmpty,
      });
      if (graceClose || emptyReclaim) {
        toEndIds.push(ev.id);
      }
    }
    if (toEndIds.length > 0) {
      const r3b = await tx.event.updateMany({
        where: { id: { in: toEndIds } },
        data: { status: 'ENDED' },
      });
      counts.toEnded += r3b.count;
      await closeOpenSessions(tx, toEndIds, now);
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

  // ── Edge-trigger del recorder (ADR-013 Fase 3) ───────────────────
  // Quando un evento è appena passato a LIVE, notifichiamo (best-effort,
  // fire-and-forget) l'operator recorder così crea subito il Job/container
  // senza attendere il suo tick di reconcile. Se RECORDER_CONTROLLER_URL non
  // è impostato (deployment senza recorder), non facciamo nulla. Un errore
  // qui non deve mai compromettere lo scaler: il reconcile level-triggered
  // dell'operator recupera comunque.
  if (transitions.provisioningToLive > 0 && process.env.RECORDER_CONTROLLER_URL) {
    const url = `${process.env.RECORDER_CONTROLLER_URL.replace(/\/+$/, '')}/dispatch`;
    void fetch(url, { method: 'POST' }).catch((err) => {
      console.warn('[jvb] dispatch recorder best-effort fallito:', err);
    });
  }

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
    transitions.liveEmptyClosed > 0 ||
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

/**
 * Close any still-open CallSession rows for a batch of events. Called
 * from the scaler when events transition LIVE → IDLE (empty for 45+
 * min) or anything → ENDED (past endsAt). Runs inside the outer
 * `prisma.$transaction` so the status flip + session close are
 * atomic.
 *
 * We also denormalize the final peakParticipants from the event
 * (bumped live by Jitsi via the JVB IFrame API → admin monitoring
 * endpoint) so the session row is self-contained for analytics.
 */
async function closeOpenSessions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  eventIds: string[],
  now: Date,
) {
  if (eventIds.length === 0) return;
  const openSessions = await tx.callSession.findMany({
    where: { eventId: { in: eventIds }, endedAt: null },
    select: { id: true, eventId: true, startedAt: true },
  });
  if (openSessions.length === 0) return;

  const events = await tx.event.findMany({
    where: { id: { in: openSessions.map((s) => s.eventId) } },
    select: { id: true, peakParticipants: true },
  });
  const peakById = new Map(events.map((e) => [e.id, e.peakParticipants]));

  await Promise.all(
    openSessions.map((s) => {
      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - s.startedAt.getTime()) / 1000),
      );
      return tx.callSession.update({
        where: { id: s.id },
        data: {
          endedAt: now,
          duration: durationSeconds,
          peakParticipants: peakById.get(s.eventId) ?? 0,
        },
      });
    }),
  );
}
