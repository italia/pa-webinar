import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { publicEventStatusWhere } from '@/lib/events/visibility';
import { jibriRecordingExpected } from '@/lib/infrastructure';
import { recorderWaitingSince } from '@/lib/jitsi/recorder-wait';
import { readJvbSnapshot } from '@/lib/jvb-snapshot';
import { jvbMaxReplicasFromEnv, JVB_BILLABLE_STATUSES } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';
import {
  bridgeMode,
  fetchColibriStats,
  fetchJibriHealth,
  loadJvbDemand,
  type BridgeMode,
  type JvbSizingSettings,
} from '@/lib/status/bridge';
import {
  activeStatusWhere,
  compareForStatusList,
  RUNNING_STATUSES,
} from '@/lib/status/event-activity';
import { getJitsiHealth, type JitsiComponentHealth } from '@/lib/status/jitsi-health';
import { statusDataVisible } from '@/lib/status-page';
import { getLocalized, resolveLocale, type LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

/**
 * Stato del registratore letto dalla sala live (lib/jitsi/bridge-readiness):
 *   - `ready`       l'API di salute risponde;
 *   - `scaling`     serve e si sta accendendo;
 *   - `failed`      serve, ma non si e' acceso entro il tempo massimo di
 *                   allestimento: la sala smette di dire «in avvio»;
 *   - `standby`     spento perche' nessun evento lo chiede;
 *   - `unavailable` Jibri non previsto: storage delle registrazioni non
 *                   dichiarato (lib/infrastructure#jibriRecordingExpected).
 */
type JibriStatus = 'ready' | 'scaling' | 'failed' | 'standby' | 'unavailable';

interface ComponentStatus {
  name: string;
  status: 'operational' | 'degraded' | 'outage' | 'standby' | 'unknown';
  responseTime?: number;
  details?: string;
}

interface SystemStatus {
  overall: 'operational' | 'degraded' | 'outage';
  components: ComponentStatus[];
  metrics: {
    activeEvents: number;
    idleEvents: number;
    provisioningEvents: number;
    totalRegistrationsToday: number;
    jvbDesiredReplicas: number;
    jvbRunningReplicas: number;
    jvbStatus: 'ready' | 'scaling' | 'standby';
    /** Uno scaler accende i bridge (scale-to-zero); altrimenti sono fissi. */
    jvbScalerEnabled: boolean;
    /** L'applicazione può interrogare il ponte video (o lo scaler lo fa per lei). */
    jvbMonitored: boolean;
    /** Con lo scaler il tetto dei bridge; senza, il numero di bridge fissi. */
    jvbMaxReplicas: number;
    jvbStressLevel: number | null;
    /** Endpoint sul ponte video: una persona sola in una stanza non ci arriva. */
    jvbParticipants: number | null;
    jvbConferences: number | null;
    jvbStale: boolean;
    // Octo (multi-bridge cascading). Populated from /colibri/stats of
    // whichever JVB pod the service LB routes us to — aggregate across
    // bridges requires per-pod queries which we don't do here.
    jvbOctoEnabled: boolean;
    jvbOctoConferences: number | null;
    jvbOctoEndpoints: number | null;
    jvbOctoSendBitrateBps: number | null;
    jibriStatus: JibriStatus;
    jibriRunningReplicas: number;
    jibriStale: boolean;
    // Orphan recordings awaiting operator decision or auto-cleanup.
    // A non-zero pending count is surfaced as a status-page warning so
    // the operator knows the reconcile cron is producing data.
    orphanRecordingsPending: number;
  };
  upcomingEvents: {
    title: string;
    startsAt: string;
    status: string;
    maxParticipants: number;
    videoEnabled: boolean;
  }[];
  config: {
    provisioningTimeoutMinutes: number;
    pollIntervalSeconds: number;
  };
  lastChecked: string;
}

async function checkDatabase(): Promise<ComponentStatus> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const responseTime = Date.now() - start;
    return {
      name: 'database',
      status: responseTime > 1000 ? 'degraded' : 'operational',
      responseTime,
    };
  } catch {
    return { name: 'database', status: 'outage', responseTime: Date.now() - start };
  }
}

/**
 * Un componente di Jitsi nel vocabolario di questa rotta. Ognuno ha la sua
 * sonda (lib/status/jitsi-health): sala web, Prosody e Jicofo non si copiano
 * più lo stato a vicenda.
 */
function jitsiComponent(name: string, health: JitsiComponentHealth): ComponentStatus {
  const component: ComponentStatus = { name, status: health.status };
  if (health.responseMs !== null) component.responseTime = health.responseMs;
  if (health.details) component.details = health.details;
  else if (health.status === 'operational') component.details = 'Healthy';
  return component;
}

async function checkSmtp(): Promise<ComponentStatus> {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    return { name: 'smtp', status: 'unknown', details: 'Not configured' };
  }
  return { name: 'smtp', status: 'operational', details: 'Configured' };
}

/**
 * Redis health check. Redis is a required dependency — it fans out
 * chat messages across pods. A missing or unreachable Redis means
 * users on different pods can't see each other's chat, which is an
 * outage, not a degradation. Canonical chat state still lives in
 * Postgres so messages aren't lost, but the real-time feature is
 * broken and the operator needs to see that.
 */
async function checkRedis(): Promise<ComponentStatus> {
  const { getRedis } = await import('@/lib/redis');
  const redis = getRedis();
  if (!redis) {
    return {
      name: 'redis',
      status: 'outage',
      details: 'REDIS_URL not configured',
    };
  }
  const start = Date.now();
  try {
    const pong = await Promise.race([
      redis.ping(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('redis ping timeout')), 2000),
      ),
    ]);
    const responseTime = Date.now() - start;
    if (pong !== 'PONG') {
      return { name: 'redis', status: 'outage', responseTime, details: String(pong) };
    }
    return {
      name: 'redis',
      status: responseTime > 500 ? 'degraded' : 'operational',
      responseTime,
    };
  } catch (e) {
    return {
      name: 'redis',
      status: 'outage',
      responseTime: Date.now() - start,
      details: e instanceof Error ? e.message : 'ping failed',
    };
  }
}

interface JvbStatusResult {
  component: ComponentStatus;
  mode: BridgeMode;
  desired: number;
  running: number;
  maxReplicas: number;
  jvbStatus: 'ready' | 'scaling' | 'standby';
  stressLevel: number | null;
  participants: number | null;
  conferences: number | null;
  octoEnabled: boolean;
  octoConferences: number | null;
  octoEndpoints: number | null;
  octoSendBitrateBps: number | null;
  /** True when ≥1 billable event has been waiting for JVB longer than the configured timeout. */
  stale: boolean;
}

function numberField(stats: Record<string, unknown>, key: string): number | null {
  const v = stats[key];
  return typeof v === 'number' ? v : null;
}

/**
 * Il ponte senza scaler (lib/status/bridge#bridgeMode). I bridge sono sempre
 * accesi: il ponte risponde («operativo») o no («interruzione»), qualunque
 * cosa dicano gli eventi. Nessuno «standby», nessun «in preparazione», nessun
 * evento «in attesa del bridge» da segnalare a un autoscaler che non c'è.
 *
 * `jvbStatus` resta nel vocabolario che legge la sala d'attesa
 * (lib/jitsi/bridge-readiness): `ready` quando il ponte risponde, `standby`
 * (cioè «non lo so») altrimenti — mai `scaling`, che fermerebbe l'ingresso
 * ad aspettare un'accensione che nessuno farà.
 */
async function getFixedBridgeStatus(mode: 'fixed' | 'unmonitored'): Promise<JvbStatusResult> {
  const expected = jvbMaxReplicasFromEnv();
  const empty = {
    mode,
    maxReplicas: expected,
    stressLevel: null,
    participants: null,
    conferences: null,
    octoEnabled: false,
    octoConferences: null,
    octoEndpoints: null,
    octoSendBitrateBps: null,
    stale: false,
  } as const;

  if (mode === 'unmonitored') {
    return {
      ...empty,
      component: { name: 'jvb', status: 'unknown', details: 'Not monitored' },
      desired: 0,
      running: 0,
      jvbStatus: 'standby',
    };
  }

  const stats = await fetchColibriStats();
  if (!stats || stats.healthy === false) {
    return {
      ...empty,
      component: { name: 'jvb', status: 'outage', details: 'Bridge not answering' },
      desired: expected,
      running: 0,
      jvbStatus: 'standby',
    };
  }

  const octoConferences = numberField(stats, 'octo_conferences');
  const octoSendBitrateBps = numberField(stats, 'octo_send_bitrate');
  return {
    ...empty,
    component: {
      name: 'jvb',
      status: 'operational',
      details: `Bridge answering (${expected} configured)`,
    },
    desired: expected,
    running: 1,
    jvbStatus: 'ready',
    stressLevel: numberField(stats, 'stress_level'),
    participants: numberField(stats, 'participants'),
    conferences: numberField(stats, 'conferences'),
    octoConferences,
    octoEndpoints: numberField(stats, 'octo_endpoints'),
    octoSendBitrateBps,
    octoEnabled: (octoConferences ?? 0) > 0 || (octoSendBitrateBps ?? 0) > 0,
  };
}

async function getJvbStatus(
  settings: JvbSizingSettings,
  provisioningTimeoutMinutes: number,
): Promise<JvbStatusResult> {
  try {
    const mode = bridgeMode();
    if (mode !== 'scaler') return await getFixedBridgeStatus(mode);

    // Da qui in giù: bridge accesi e spenti da uno scaler (scale-to-zero).
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - provisioningTimeoutMinutes * 60 * 1000);

    // LIVE + PROVISIONING: already billing JVB capacity.
    // PUBLISHED within the pre-scale window: scaler will promote them to
    // PROVISIONING shortly, so we count them too to avoid a visible dip.
    // IDLE is deliberately excluded (that's the whole point of scale-to-zero).
    const { events, desired, maxReplicas } = await loadJvbDemand(settings, now);

    // Stale-provisioning alert: an event should have JVB ready within
    // provisioningTimeoutMinutes from when it became billable. If not, the
    // cluster autoscaler is stuck OR the JVB is failing to boot — surface
    // this on the status page instead of letting JVB remain in "scaling".
    // Reference timestamp: provisioningStartedAt if set, otherwise startsAt.
    const staleEvents = events.filter((e) => {
      const since = e.provisioningStartedAt ?? e.startsAt;
      return since <= staleCutoff;
    });

    let running = 0;
    let stressLevel: number | null = null;
    let participants: number | null = null;
    let conferences: number | null = null;
    let octoEnabled = false;
    let octoConferences: number | null = null;
    let octoEndpoints: number | null = null;
    let octoSendBitrateBps: number | null = null;

    // Authoritative snapshot: the scaler CronJob has K8s RBAC to read the
    // JVB deployment AND `pods/exec` to reach each pod's /colibri/stats.
    // It aggregates per-pod stats and writes the result here. The direct
    // /colibri/stats call below only tells us what ONE pod (whichever the
    // Service VIP routes us to) reports — it caps running at 1 and zeroes
    // participants/stress whenever traffic lives on a sibling pod.
    const snapshot = await readJvbSnapshot();
    const snapshotHasTraffic = snapshot?.pollSuccesses !== undefined && snapshot.pollSuccesses > 0;
    if (snapshot) {
      running = snapshot.ready;
    }
    if (snapshotHasTraffic) {
      participants = snapshot!.participants ?? null;
      conferences = snapshot!.conferences ?? null;
      stressLevel = snapshot!.stressLevel ?? null;
      octoConferences = snapshot!.octoConferences ?? null;
      octoEndpoints = snapshot!.octoEndpoints ?? null;
      octoSendBitrateBps = snapshot!.octoSendBitrateBps ?? null;
      octoEnabled = (octoConferences ?? 0) > 0 || (octoSendBitrateBps ?? 0) > 0;
    }

    // Fall back to a single /colibri/stats probe when the snapshot is missing
    // aggregated traffic data (fresh pod, Redis cold, or older scaler image).
    // With one JVB replica this is still correct; with many it's a lower
    // bound for the bridge that happens to answer.
    if (!snapshotHasTraffic) {
      const stats = await fetchColibriStats();
      if (stats && stats.healthy !== false) {
        // Fallback when the Redis snapshot is missing entirely. We know
        // at least one pod is answering; reporting 1 beats 0.
        if (!snapshot) running = 1;
        stressLevel = numberField(stats, 'stress_level');
        participants = numberField(stats, 'participants');
        conferences = numberField(stats, 'conferences');
        octoConferences = numberField(stats, 'octo_conferences');
        octoEndpoints = numberField(stats, 'octo_endpoints');
        octoSendBitrateBps = numberField(stats, 'octo_send_bitrate');
        octoEnabled = (octoConferences ?? 0) > 0 || (octoSendBitrateBps ?? 0) > 0;
      }
    }

    const isStale = staleEvents.length > 0 && running < desired;

    let jvbStatus: 'ready' | 'scaling' | 'standby' = 'standby';
    if (desired === 0) {
      jvbStatus = 'standby';
    } else if (running >= desired) {
      jvbStatus = 'ready';
    } else {
      jvbStatus = 'scaling';
    }

    const statusText = desired === 0
      ? 'Scale-to-zero — no events'
      : isStale
        ? `Stale: ${staleEvents.length} event(s) waiting JVB for >${provisioningTimeoutMinutes} min`
        : jvbStatus === 'scaling'
          ? `Scaling: ${running}/${desired} replicas ready`
          : `${running}/${maxReplicas} replicas ready`;

    // Status priority:
    //   standby  → no events need JVB (normal for scale-to-zero)
    //   degraded → stale (events waiting but bridge not ready)
    //   operational → running matches desired
    //   degraded → scaling in flight (not stale yet)
    const componentStatus: ComponentStatus['status'] = desired === 0
      ? 'standby'
      : isStale
        ? 'degraded'
        : jvbStatus === 'ready'
          ? 'operational'
          : 'degraded';

    return {
      component: {
        name: 'jvb',
        status: componentStatus,
        details: statusText,
      },
      mode,
      desired,
      running,
      maxReplicas,
      jvbStatus,
      stressLevel,
      participants,
      conferences,
      octoEnabled,
      octoConferences,
      octoEndpoints,
      octoSendBitrateBps,
      stale: isStale,
    };
  } catch {
    return {
      component: { name: 'jvb', status: 'unknown' },
      mode: bridgeMode(),
      desired: 0,
      running: 0,
      maxReplicas: jvbMaxReplicasFromEnv(),
      jvbStatus: 'standby',
      stressLevel: null,
      participants: null,
      conferences: null,
      octoEnabled: false,
      octoConferences: null,
      octoEndpoints: null,
      octoSendBitrateBps: null,
      stale: false,
    };
  }
}

async function getJibriStatus(
  /** Eventi in diretta o in allestimento con la registrazione attiva. */
  recordingEventIds: readonly string[],
  recordingStale: boolean,
  startTimeoutMinutes: number,
  now: Date,
): Promise<{
  component: ComponentStatus;
  running: number;
  jibriStatus: JibriStatus;
}> {
  // Solo un'installazione che dichiara lo storage di Jibri se lo aspetta
  // (lib/infrastructure#jibriRecordingExpected): altrove un'API di salute che
  // non risponde non è un registratore in avvio, è un registratore che non c'è.
  if (!jibriRecordingExpected()) {
    return {
      component: { name: 'jibri', status: 'standby', details: 'Not configured' },
      running: 0,
      jibriStatus: 'unavailable',
    };
  }

  const recordingNeeded = recordingEventIds.length > 0;
  let running = 0;
  let busyStatus: string | null = null;

  if (process.env.JIBRI_HEALTH_URL) {
    // Riusata per qualche secondo: la sala live interroga spesso.
    const health = await fetchJibriHealth();
    if (health?.healthy) {
      running = 1;
      busyStatus = health.busyStatus;
    }
  } else if (!process.env.KUBERNETES_SERVICE_HOST) {
    return {
      component: { name: 'jibri', status: 'operational' },
      running: 1,
      jibriStatus: 'ready',
    };
  }

  // Orologio condiviso dell'attesa (lib/jitsi/recorder-wait): parte quando un
  // evento chiede il registratore e non c'e', si azzera quando risponde o non
  // serve piu'; un evento nuovo non eredita l'attesa di uno gia' concluso.
  // Senza, un registratore che non arriva mai resterebbe «in avvio» per tutto
  // l'evento.
  const waitingSince = await recorderWaitingSince(
    recordingEventIds,
    running === 0,
    now.getTime(),
  );

  // If no live/provisioning event asks for recording, Jibri is allowed to
  // be scaled to zero. Report "standby" instead of "degraded" so the page's
  // overall status stays green while the cluster is idle.
  if (running === 0 && !recordingNeeded) {
    return {
      component: {
        name: 'jibri',
        status: 'standby',
        details: 'Scale-to-zero — no recording required',
      },
      running: 0,
      jibriStatus: 'standby',
    };
  }

  const waitedMs = waitingSince === null ? 0 : now.getTime() - waitingSince;
  const startTimedOut = running === 0 && waitedMs >= startTimeoutMinutes * 60_000;

  const jibriStatus: JibriStatus =
    running > 0 ? 'ready' : startTimedOut ? 'failed' : 'scaling';

  // If the event requesting recording has been waiting past the
  // provisioning timeout, flag Jibri as degraded with a stale-specific
  // message instead of the generic "scaling up".
  const details = running > 0
    ? `${running} instance(s) ready${busyStatus ? ` (${busyStatus})` : ''}`
    : startTimedOut
      ? `Not started: requested ${Math.round(waitedMs / 60_000)} min ago, health API not answering`
      : recordingStale
        ? 'Stale: event with recording waiting Jibri past timeout'
        : 'No instances running — scaling up';

  return {
    component: {
      name: 'jibri',
      status: running > 0 ? 'operational' : 'degraded',
      details,
    },
    running,
    jibriStatus,
  };
}

/** Quanti eventi in diretta o in allestimento si elencano al massimo. */
const RUNNING_LIST_CAP = 20;
/** Quanti eventi futuri si elencano. */
const UPCOMING_LIST_CAP = 5;

const upcomingSelect = {
  title: true,
  startsAt: true,
  status: true,
  maxParticipants: true,
  participantsCanStartVideo: true,
} as const;

export const GET = withErrorHandling(async (request) => {
  const settings = await getSettings();
  const provisioningTimeoutMinutes = settings.jvbProvisioningTimeoutMinutes ?? 15;
  const pollIntervalSeconds = settings.statusPollIntervalSeconds ?? 30;

  // Pull recording-enabled events in LIVE/PROVISIONING once; drive both the
  // "Jibri is expected to be up" signal and the stale-provisioning check.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - provisioningTimeoutMinutes * 60 * 1000);
  const recordingEvents = await prisma.event.findMany({
    where: {
      status: { in: [...JVB_BILLABLE_STATUSES] },
      recordingEnabled: true,
    },
    select: { id: true, startsAt: true, provisioningStartedAt: true },
  });
  const recordingEventIds = recordingEvents.map((e) => e.id);
  const recordingStale = recordingEvents.some((e) => {
    const since = e.provisioningStartedAt ?? e.startsAt;
    return since <= staleCutoff;
  });

  // Pagina di stato spenta dall'amministrazione (lib/status-page): la sala
  // live continua a chiedere qui se il ponte video e il registratore sono
  // pronti (lib/jitsi/bridge-readiness), e riceve quei valori e nient'altro —
  // niente componenti, conteggi o prossimi eventi.
  if (!(await statusDataVisible())) {
    const [jvbSala, jibriSala] = await Promise.all([
      getJvbStatus(settings, provisioningTimeoutMinutes),
      getJibriStatus(recordingEventIds, recordingStale, provisioningTimeoutMinutes, now),
    ]);
    return Response.json(
      {
        metrics: {
          jvbStatus: jvbSala.jvbStatus,
          jvbParticipants: jvbSala.participants,
          jvbStale: jvbSala.stale,
          jibriStatus: jibriSala.jibriStatus,
        },
        lastChecked: now.toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const [db, jitsiHealth, smtp, redisHealth, jvb, jibriResult, orphanRecordingsPendingCount] = await Promise.all([
    checkDatabase(),
    getJitsiHealth(),
    checkSmtp(),
    checkRedis(),
    getJvbStatus(settings, provisioningTimeoutMinutes),
    getJibriStatus(recordingEventIds, recordingStale, provisioningTimeoutMinutes, now),
    prisma.orphanRecording.count({ where: { decision: 'pending' } }).catch(() => 0),
  ]);

  const app: ComponentStatus = { name: 'app', status: 'operational' };
  const jibri = jibriResult.component;
  const jitsi = jitsiComponent('jitsi', jitsiHealth.web);
  const prosody = jitsiComponent('prosody', jitsiHealth.prosody);
  const jicofo = jitsiComponent('jicofo', jitsiHealth.jicofo);

  const components = [app, db, jitsi, prosody, jicofo, jvb.component, jibri, smtp, redisHealth];

  const hasOutage = components.some((c) => c.status === 'outage');
  const hasDegraded = components.some((c) => c.status === 'degraded');
  const overall: SystemStatus['overall'] = hasOutage
    ? 'outage'
    : hasDegraded
      ? 'degraded'
      : 'operational';

  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // L'elenco pubblico segue le regole di visibilità delle altre superfici
  // pubbliche (lib/events/visibility): niente chiamate istantanee, che sono
  // link-only e non hanno una pagina. Le dirette ci sono sempre, anche oltre
  // l'orario di fine, e vengono per prime; si limitano solo quelle future.
  const visibili = publicEventStatusWhere({ includeEnded: false });
  const [activeEvents, idleEvents, provisioningEvents, totalRegsToday, runningEvents, futureEvents] =
    await Promise.all([
      prisma.event.count({ where: activeStatusWhere('LIVE', now) }),
      prisma.event.count({ where: activeStatusWhere('IDLE', now) }),
      prisma.event.count({ where: activeStatusWhere('PROVISIONING', now) }),
      prisma.registration.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.event.findMany({
        where: {
          AND: [
            visibili,
            {
              OR: RUNNING_STATUSES.map((stato) => activeStatusWhere(stato, now)),
            },
          ],
        },
        orderBy: { startsAt: 'asc' },
        take: RUNNING_LIST_CAP,
        select: upcomingSelect,
      }),
      prisma.event.findMany({
        where: {
          AND: [
            visibili,
            { OR: [activeStatusWhere('PUBLISHED', now), activeStatusWhere('IDLE', now)] },
          ],
        },
        orderBy: { startsAt: 'asc' },
        take: UPCOMING_LIST_CAP,
        select: upcomingSelect,
      }),
    ]);
  const upcomingEvents = [...runningEvents].sort(compareForStatusList).concat(futureEvents);
  // I titoli nella lingua di chi guarda (la pagina passa ?locale=).
  const locale = resolveLocale(request);

  const status: SystemStatus = {
    overall,
    components,
    metrics: {
      activeEvents,
      idleEvents,
      provisioningEvents,
      totalRegistrationsToday: totalRegsToday,
      jvbDesiredReplicas: jvb.desired,
      jvbRunningReplicas: jvb.running,
      jvbStatus: jvb.jvbStatus,
      jvbScalerEnabled: jvb.mode === 'scaler',
      jvbMonitored: jvb.mode !== 'unmonitored',
      jvbMaxReplicas: jvb.maxReplicas,
      jvbStressLevel: jvb.stressLevel,
      jvbParticipants: jvb.participants,
      jvbConferences: jvb.conferences,
      jvbStale: jvb.stale,
      jvbOctoEnabled: jvb.octoEnabled,
      jvbOctoConferences: jvb.octoConferences,
      jvbOctoEndpoints: jvb.octoEndpoints,
      jvbOctoSendBitrateBps: jvb.octoSendBitrateBps,
      jibriStatus: jibriResult.jibriStatus,
      jibriRunningReplicas: jibriResult.running,
      // Solo dove Jibri è previsto: altrove un evento con la registrazione
      // accesa non aspetta nessun Jibri, e l'avviso diceva il contrario.
      jibriStale:
        jibriRecordingExpected() &&
        (recordingStale || jibriResult.jibriStatus === 'failed') &&
        jibriResult.running === 0,
      orphanRecordingsPending: orphanRecordingsPendingCount,
    },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: getLocalized(e.title as LocalizedField, locale),
      startsAt: e.startsAt.toISOString(),
      status: e.status,
      maxParticipants: e.maxParticipants,
      videoEnabled: e.participantsCanStartVideo,
    })),
    config: {
      provisioningTimeoutMinutes,
      pollIntervalSeconds,
    },
    lastChecked: now.toISOString(),
  };

  return Response.json(status, {
    headers: { 'Cache-Control': 'no-store' },
  });
});
