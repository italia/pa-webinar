/**
 * Il giro del ciclo di vita degli eventi: le transizioni di stato automatiche
 * e la chiusura delle sessioni di chiamata.
 *
 * Due modi, uno per conduttore (vedi lifecycle-driver.ts):
 *
 *  - `scaler`: il comportamento dello scaler dei bridge, chiamato da
 *    GET /api/internal/jvb-desired-replicas. Scalda la sala prima dell'inizio
 *    (PUBLISHED → PROVISIONING → LIVE), la mette in pausa quando si svuota
 *    (LIVE → IDLE) e la chiude. Il bridge si accende e si spegne attorno a
 *    queste transizioni.
 *
 *  - `fixed`: il giro a bridge fisso, chiamato da GET /api/cron/lifecycle
 *    quando lo scaler non c'è (profili semplice e standard, k3s, minikube,
 *    Docker Compose, Jitsi esterno). Il bridge c'è sempre, quindi niente
 *    pre-riscaldamento e niente pausa: la sala si apre all'orario d'inizio
 *    (se il bridge risponde) e si chiude con le stesse regole di tempo dello
 *    scaler. Una sala a tempo indefinito si chiude dopo la finestra di
 *    inattività senza segni di vita.
 *
 * In entrambi i modi ogni evento che lascia LIVE chiude le proprie sessioni
 * nella stessa transazione, e a fine giro si riparano le sessioni rimaste
 * aperte su eventi già conclusi.
 */

import type { EventStatus, SiteSetting } from '@prisma/client';

import { prisma } from '@/lib/db';
import {
  shouldCloseAbandonedInstantCall,
  shouldDemoteLiveToIdle,
  shouldEndLiveEvent,
  shouldReclaimEmptyOvertime,
  emptyCloseCutoff,
} from '@/lib/events/lifecycle';
import { closeOpenSessions, closeSessionsOfEndedEvents } from '@/lib/events/call-sessions';
import { publishEventStatus } from '@/lib/live-state/publish';
import { fetchColibriStats } from '@/lib/status/bridge';

export type LifecycleMode = 'scaler' | 'fixed';

/** Finestre del ciclo di vita, lette da SiteSetting con i ripieghi d'ambiente. */
export interface LifecycleWindows {
  /** Minuti senza segni di vita dopo cui una sala è inattiva. */
  inactiveGraceMin: number;
  /** Minuti di pre-riscaldamento prima dell'inizio (solo scaler). */
  preScaleMin: number;
  /** Chiusura anticipata di una sala vuota; negativo = spenta. */
  emptyCloseMin: number;
  /** Grace di sito dopo `endsAt`. */
  siteGrace: number;
}

export function lifecycleWindows(
  settings: Pick<
    SiteSetting,
    | 'jvbInactiveGraceMinutes'
    | 'jvbPreScaleMinutes'
    | 'jvbEmptyCloseMinutes'
    | 'eventGracePeriodMinutes'
  >,
  env: Record<string, string | undefined> = process.env,
): LifecycleWindows {
  return {
    inactiveGraceMin:
      settings.jvbInactiveGraceMinutes ?? parseInt(env.JVB_INACTIVE_GRACE_MIN || '45', 10),
    preScaleMin:
      settings.jvbPreScaleMinutes ?? parseInt(env.JVB_PRE_SCALE_MINUTES || '10', 10),
    // Authoritative empty-conference close. Minutes a LIVE room
    // that HAD traffic may stay COMPLETELY empty (moderator included) before we
    // flip it straight to ENDED — terminal, distinct from the scale-to-zero
    // inactivity grace. DISABLED by default (-1); opt-in admin setting only,
    // because a terminal close on a stale participants=0 reading would eject a
    // still-populated room. The column is NOT NULL so the env fallback only
    // guards a hypothetical null (unreachable on a provisioned singleton).
    emptyCloseMin:
      settings.jvbEmptyCloseMinutes ?? parseInt(env.JVB_EMPTY_CLOSE_MIN || '-1', 10),
    siteGrace: settings.eventGracePeriodMinutes ?? 15,
  };
}

export interface BridgeStats {
  participants: number;
  conferences: number;
  stressLevel: number;
  reachable: boolean;
}

/**
 * Sonda del bridge: `/colibri/stats` su JVB_HEALTH_URL, con la stessa regola
 * della pagina di stato (lib/status/bridge#fetchColibriStats: indirizzo
 * normalizzato, tre secondi al massimo, risultato tenuto qualche secondo).
 * Senza JVB_HEALTH_URL, se non risponde o se si dichiara non in salute
 * (`healthy: false`), `reachable` è falso.
 */
export async function probeBridge(
  url: string | undefined = process.env.JVB_HEALTH_URL,
): Promise<BridgeStats> {
  const s = await fetchColibriStats({ JVB_HEALTH_URL: url });
  if (!s || s.healthy === false) {
    return { participants: 0, conferences: 0, stressLevel: 0, reachable: false };
  }
  return {
    participants: typeof s.participants === 'number' ? s.participants : 0,
    conferences: typeof s.conferences === 'number' ? s.conferences : 0,
    stressLevel: typeof s.stress_level === 'number' ? s.stress_level : 0,
    reachable: true,
  };
}

export interface ScalerTickInput {
  mode: 'scaler';
  now: Date;
  windows: LifecycleWindows;
  /** Il bridge risponde (sonda diretta o aggregazione dello scaler). */
  jvbReachable: boolean;
  /** Partecipanti sul bridge (somma su tutti i pod se aggregata). */
  participants: number;
  /** Lo scaler ha aggregato le statistiche di tutti i pod in questo giro. */
  scalerAggregated: boolean;
  /** spec.replicas del Deployment JVB, se lo scaler lo ha passato. */
  currentReplicas: number | null;
}

export interface FixedTickInput {
  mode: 'fixed';
  now: Date;
  windows: LifecycleWindows;
  bridge: {
    /** JVB_HEALTH_URL è impostato: la sonda dice qualcosa. */
    probed: boolean;
    reachable: boolean;
    participants: number;
  };
}

export interface ScalerTransitions {
  liveRefreshed: number;
  liveEmptyClosed: number;
  liveToIdle: number;
  toEnded: number;
  publishedToProvisioning: number;
  provisioningToLive: number;
}

export interface FixedTransitions {
  liveRefreshed: number;
  liveEmptyClosed: number;
  /** Eventi aperti all'orario d'inizio (PUBLISHED/PROVISIONING/IDLE → LIVE). */
  toLive: number;
  toEnded: number;
}

export interface StatusChange {
  id: string;
  status: EventStatus;
}

export interface LifecycleTickResult<T> {
  transitions: T;
  /** Eventi il cui stato è cambiato in questo giro. */
  changes: StatusChange[];
  /** Sessioni rimaste aperte su eventi già conclusi e chiuse ora. */
  sessionsRepaired: number;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function runLifecycleTick(
  input: ScalerTickInput,
): Promise<LifecycleTickResult<ScalerTransitions>>;
export async function runLifecycleTick(
  input: FixedTickInput,
): Promise<LifecycleTickResult<FixedTransitions>>;
export async function runLifecycleTick(
  input: ScalerTickInput | FixedTickInput,
): Promise<LifecycleTickResult<ScalerTransitions | FixedTransitions>> {
  const { transitions, changes } = await prisma.$transaction(async (tx) =>
    input.mode === 'scaler' ? scalerTransitions(tx, input) : fixedTransitions(tx, input),
  );

  // La notifica non deve mai far fallire il giro: si manda dopo il commit,
  // senza attenderla (lib/live-state/publish).
  for (const c of changes) publishEventStatus(c.id, c.status);

  const sessionsRepaired = await repairSessions(input.now, input.windows.siteGrace);
  return { transitions, changes, sessionsRepaired };
}

/**
 * Chiude le sessioni rimaste aperte su eventi già conclusi. Transazione a
 * parte e mai un errore: è una riparazione, il giro è già fatto.
 */
async function repairSessions(now: Date, siteGrace: number): Promise<number> {
  try {
    return await prisma.$transaction((tx) => closeSessionsOfEndedEvents(tx, now, siteGrace));
  } catch (err) {
    console.warn('[lifecycle] chiusura delle sessioni rimaste aperte non riuscita:', err);
    return 0;
  }
}

/**
 * Avvisa il controller del registratore che una sala è appena diventata LIVE,
 * perché crei subito il Job senza attendere il suo giro di riconciliazione.
 * Best-effort: senza RECORDER_CONTROLLER_URL non fa nulla, e un errore non
 * tocca il giro (la riconciliazione dell'operator recupera comunque).
 */
export function dispatchRecorder(env: Record<string, string | undefined> = process.env): void {
  if (!env.RECORDER_CONTROLLER_URL) return;
  const url = `${env.RECORDER_CONTROLLER_URL.replace(/\/+$/, '')}/dispatch`;
  void fetch(url, { method: 'POST' }).catch((err) => {
    console.warn('[jvb] dispatch recorder best-effort fallito:', err);
  });
}

// ── Modo scaler ──────────────────────────────────────────────────────────
// Il comportamento storico di GET /api/internal/jvb-desired-replicas,
// spostato qui senza cambiarne le regole.

async function scalerTransitions(
  tx: Tx,
  input: ScalerTickInput,
): Promise<{ transitions: ScalerTransitions; changes: StatusChange[] }> {
  const { now, windows, jvbReachable, participants, scalerAggregated, currentReplicas } = input;
  const preScaleWindow = new Date(now.getTime() + windows.preScaleMin * 60_000);
  const inactiveCutoff = new Date(now.getTime() - windows.inactiveGraceMin * 60_000);
  const emptyCloseCut = emptyCloseCutoff(now, windows.emptyCloseMin);
  const changes: StatusChange[] = [];

  const counts: ScalerTransitions = {
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

  // The LIVE-before-endsAt set, shared by the empty-close (1b) and the IDLE
  // demotion (2). Both decide in `shouldDemoteLiveToIdle` rather than in a
  // WHERE clause: the rule needs the LATEST of several timestamps (SQL would
  // need GREATEST, which Prisma cannot express here) and it is worth
  // unit-testing on its own. The set is at most a handful of rows.
  const liveEvents = await tx.event.findMany({
    where: { status: 'LIVE', endsAt: { gt: now } },
    select: {
      id: true,
      lastActiveAt: true,
      provisioningStartedAt: true,
      startsAt: true,
    },
  });

  // 1b) LIVE → ENDED — authoritative empty-conference close.
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
    // `lastActiveAt !== null` keeps the "had traffic, then emptied" meaning;
    // the shared predicate adds the freshness guards. Without them this
    // TERMINAL close inherits the bug fixed one branch below: a room revived
    // hours later still carries the OLD lastActiveAt (the demotion writes only
    // `status`, and /wake refreshes provisioningStartedAt), so it would be
    // ENDed — irreversibly — before anyone could join.
    const emptyCloseCandidates = liveEvents.filter(
      (e) =>
        e.lastActiveAt !== null &&
        shouldDemoteLiveToIdle({
          lastActiveAt: e.lastActiveAt,
          provisioningStartedAt: e.provisioningStartedAt,
          startsAt: e.startsAt,
          inactiveCutoff: emptyCloseCut,
          now,
        }),
    );
    if (emptyCloseCandidates.length > 0) {
      const closedIds = emptyCloseCandidates.map((e) => e.id);
      const r = await tx.event.updateMany({
        where: { id: { in: closedIds } },
        data: { status: 'ENDED' },
      });
      counts.liveEmptyClosed = r.count;
      await closeOpenSessions(tx, closedIds, now);
      changes.push(...closedIds.map((id) => ({ id, status: 'ENDED' as const })));
    }
  }

  // 2) LIVE → IDLE when the conference has been empty for ≥ grace.
  //    "Empty for how long" is the LATEST of lastActiveAt, provisioningStartedAt
  //    and (once past) startsAt — see shouldDemoteLiveToIdle, which also
  //    documents why a room with no signal at all is left alone. Uses the
  //    shared skipIdleDemotion guard computed above (multi-replica staleness).
  //    NOTE: this is a REVIVABLE, future-endsAt demotion, so it intentionally
  //    uses simpler empty-detection than the terminal past-endsAt reclaim in
  //    step 3b (shouldReclaimEmptyOvertime), which adds max-of-signals +
  //    endsAt fallback + a stricter reliability gate BECAUSE it closes to
  //    ENDED. The two are deliberately NOT the same predicate — don't unify.
  if (!skipIdleDemotion) {
    const idleCandidates = liveEvents.filter((e) =>
      shouldDemoteLiveToIdle({
        lastActiveAt: e.lastActiveAt,
        provisioningStartedAt: e.provisioningStartedAt,
        startsAt: e.startsAt,
        inactiveCutoff,
        now,
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
      // `now` as the close time. Tradeoff: a bit of extra "duration"
      // equal to the 45-min inactivity grace, acceptable for post-event
      // analytics.
      await closeOpenSessions(tx, demotedIds, now);
      changes.push(...demotedIds.map((id) => ({ id, status: 'IDLE' as const })));
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
    changes.push(
      ...endedByTimeoutCandidates.map((e) => ({ id: e.id, status: 'ENDED' as const })),
    );
  }

  const liveOvertime = await tx.event.findMany({
    where: { status: 'LIVE', endsAt: { lt: now } },
    select: {
      id: true,
      eventType: true,
      endsAt: true,
      gracePeriodMinutes: true,
      lastActiveAt: true,
      provisioningStartedAt: true,
      _count: { select: { registrations: true } },
    },
  });
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
      siteGraceMinutes: windows.siteGrace,
      now,
    });
    const emptyReclaim = shouldReclaimEmptyOvertime({
      gracePeriodMinutes: ev.gracePeriodMinutes,
      siteGraceMinutes: windows.siteGrace,
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
    changes.push(...toEndIds.map((id) => ({ id, status: 'ENDED' as const })));
  }

  // 4) PUBLISHED → PROVISIONING when startsAt enters the pre-scale window,
  //    or when startsAt has already passed and nobody moved the state yet.
  //    `updateManyAndReturn` è lo stesso UPDATE con RETURNING: servono gli id
  //    per annunciare il cambio di stato.
  const r4 = await tx.event.updateManyAndReturn({
    where: {
      status: 'PUBLISHED',
      startsAt: { lte: preScaleWindow },
      endsAt: { gt: now },
    },
    data: { status: 'PROVISIONING', provisioningStartedAt: now },
    select: { id: true },
  });
  counts.publishedToProvisioning = r4.length;
  changes.push(...r4.map((e) => ({ id: e.id, status: 'PROVISIONING' as const })));

  // 5) PROVISIONING → LIVE when the bridge is up AND the event has started.
  //    We wait on bridge reachability so the first joining user doesn't
  //    land on a still-cold JVB.
  if (jvbReachable) {
    const r5 = await tx.event.updateManyAndReturn({
      where: {
        status: 'PROVISIONING',
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      data: {
        status: 'LIVE',
        // Re-stamp the warm-up time: the room became reachable NOW, whatever
        // hour a visitor's /wake first warmed it. Without this the value stays
        // the (possibly hours-old) wake time, which made the status pages
        // report "stale provisioning" on a perfectly healthy bridge and left
        // the inactivity signals looking older than the room actually is.
        provisioningStartedAt: now,
      },
      select: { id: true },
    });
    counts.provisioningToLive = r5.length;
    changes.push(...r5.map((e) => ({ id: e.id, status: 'LIVE' as const })));
  }

  return { transitions: counts, changes };
}

// ── Modo a bridge fisso ─────────────────────────────────────────────────

const OPENABLE_STATUSES: EventStatus[] = ['PUBLISHED', 'PROVISIONING', 'IDLE'];

/**
 * Se l'assenza di segni di vita di una sala vuol dire davvero che è vuota,
 * prima di chiuderla per sempre. I segni di vita arrivano da due parti:
 *  - dal bridge, se la sonda risponde: partecipanti presenti tengono viva ogni
 *    sala LIVE (passo 1);
 *  - dai resoconti dei client in sala (analytics/peak), che però un ospite
 *    senza token non può mandare su un evento con iscritti.
 * Senza sonda, quindi, il silenzio prova il vuoto solo dove ogni presente può
 * farsi sentire: una chiamata istantanea o un evento senza iscritti.
 */
function inactivityIsReliable(
  bridge: FixedTickInput['bridge'],
  ev: { eventType: string; _count: { registrations: number } },
): boolean {
  if (bridge.probed && bridge.reachable) return true;
  return ev.eventType === 'INSTANT' || ev._count.registrations === 0;
}

async function fixedTransitions(
  tx: Tx,
  input: FixedTickInput,
): Promise<{ transitions: FixedTransitions; changes: StatusChange[] }> {
  const { now, windows, bridge } = input;
  const inactiveCutoff = new Date(now.getTime() - windows.inactiveGraceMin * 60_000);
  const emptyCloseCut = emptyCloseCutoff(now, windows.emptyCloseMin);
  // Senza sonda (un Jitsi esterno, senza JVB_HEALTH_URL) il bridge
  // si dà per presente: non c'è modo di saperlo, e aspettarlo vorrebbe dire
  // non aprire mai la sala.
  const bridgePresent = bridge.probed ? bridge.reachable : true;
  const changes: StatusChange[] = [];
  const counts: FixedTransitions = { liveRefreshed: 0, liveEmptyClosed: 0, toLive: 0, toEnded: 0 };

  // Termina gli eventi indicati, se sono ancora nello stato atteso, e ne
  // chiude le sessioni. Restituisce quanti ne ha terminati.
  const end = async (ids: string[], from: EventStatus[]): Promise<number> => {
    if (ids.length === 0) return 0;
    const ended = await tx.event.updateManyAndReturn({
      where: { id: { in: ids }, status: { in: from } },
      data: { status: 'ENDED' },
      select: { id: true },
    });
    const endedIds = ended.map((e) => e.id);
    await closeOpenSessions(tx, endedIds, now);
    changes.push(...endedIds.map((id) => ({ id, status: 'ENDED' as const })));
    return endedIds.length;
  };

  // 1) Segni di vita dal bridge. Solo in positivo: partecipanti presenti
  //    tengono vive TUTTE le sale LIVE (il conteggio è per bridge, non per
  //    sala), mai il contrario. Le sale segnalano la propria attività anche da
  //    sole, con i resoconti dei client (analytics/peak).
  if (bridge.probed && bridge.reachable && bridge.participants > 0) {
    const r = await tx.event.updateMany({
      where: { status: 'LIVE' },
      data: { lastActiveAt: now },
    });
    counts.liveRefreshed = r.count;
  }

  const liveEvents = await tx.event.findMany({
    where: { status: 'LIVE', endsAt: { gt: now } },
    select: {
      id: true,
      eventType: true,
      lastActiveAt: true,
      provisioningStartedAt: true,
      startsAt: true,
    },
  });

  // 2) Chiusura anticipata di una sala vuota: facoltativa, spenta di default
  //    (jvbEmptyCloseMinutes). Come per lo scaler serve una prova che la sala
  //    sia vuota, quindi solo con la sonda del bridge che risponde.
  if (emptyCloseCut && bridge.probed && bridge.reachable) {
    const ids = liveEvents
      .filter(
        (e) =>
          e.lastActiveAt !== null &&
          shouldDemoteLiveToIdle({
            lastActiveAt: e.lastActiveAt,
            provisioningStartedAt: e.provisioningStartedAt,
            startsAt: e.startsAt,
            inactiveCutoff: emptyCloseCut,
            now,
          }),
      )
      .map((e) => e.id);
    counts.liveEmptyClosed = await end(ids, ['LIVE']);
  }

  // 3) Chiamate istantanee abbandonate prima della loro fine segnaposto.
  const abandoned = liveEvents
    .filter((e) =>
      shouldCloseAbandonedInstantCall({
        eventType: e.eventType,
        lastActiveAt: e.lastActiveAt,
        provisioningStartedAt: e.provisioningStartedAt,
        startsAt: e.startsAt,
        inactiveCutoff,
      }),
    )
    .map((e) => e.id);
  counts.toEnded += await end(abandoned, ['LIVE']);

  // 4) Oltre `endsAt`: chi non è mai stato aperto termina subito; una sala
  //    LIVE alla fine della grace, o, se è a tempo indefinito, dopo la
  //    finestra di inattività senza segni di vita.
  const neverOpened = await tx.event.findMany({
    where: { status: { in: OPENABLE_STATUSES }, endsAt: { lt: now } },
    select: { id: true },
  });
  counts.toEnded += await end(
    neverOpened.map((e) => e.id),
    OPENABLE_STATUSES,
  );

  const liveOvertime = await tx.event.findMany({
    where: { status: 'LIVE', endsAt: { lt: now } },
    select: {
      id: true,
      eventType: true,
      endsAt: true,
      gracePeriodMinutes: true,
      lastActiveAt: true,
      provisioningStartedAt: true,
      _count: { select: { registrations: true } },
    },
  });
  const overtimeIds = liveOvertime
    .filter(
      (ev) =>
        shouldEndLiveEvent({
          endsAt: ev.endsAt,
          gracePeriodMinutes: ev.gracePeriodMinutes,
          siteGraceMinutes: windows.siteGrace,
          now,
        }) ||
        shouldReclaimEmptyOvertime({
          gracePeriodMinutes: ev.gracePeriodMinutes,
          siteGraceMinutes: windows.siteGrace,
          lastActiveAt: ev.lastActiveAt,
          provisioningStartedAt: ev.provisioningStartedAt,
          endsAt: ev.endsAt,
          inactiveCutoff,
          canReclaimEmpty: inactivityIsReliable(bridge, ev),
        }),
    )
    .map((ev) => ev.id);
  counts.toEnded += await end(overtimeIds, ['LIVE']);

  // 5) Apertura all'orario d'inizio, se il bridge c'è. Niente
  //    pre-riscaldamento: il bridge è sempre acceso.
  if (bridgePresent) {
    const opened = await tx.event.updateManyAndReturn({
      where: {
        status: { in: OPENABLE_STATUSES },
        startsAt: { lte: now },
        endsAt: { gt: now },
      },
      // L'istante dell'apertura: è anche un segno di vita per le regole di
      // inattività, come nel modo scaler.
      data: { status: 'LIVE', provisioningStartedAt: now },
      select: { id: true },
    });
    counts.toLive = opened.length;
    changes.push(...opened.map((e) => ({ id: e.id, status: 'LIVE' as const })));
  }

  return { transitions: counts, changes };
}
