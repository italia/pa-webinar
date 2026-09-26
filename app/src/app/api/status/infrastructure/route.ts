import { withErrorHandling } from '@/lib/api-handler';
import { NotFoundError } from '@/lib/errors';
import { statusDataVisible } from '@/lib/status-page';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import {
  databaseBundled,
  deploymentMode,
  jibriRecordingExpected,
  recordingStorageConfigured,
  recordingStorageLabel,
} from '@/lib/infrastructure';
import { readJvbSnapshot } from '@/lib/jvb-snapshot';
import { JVB_BILLABLE_STATUSES } from '@/lib/jvb-sizing';
import { getAppProcessMetrics } from '@/lib/metrics';
import {
  isPrometheusConfigured,
  queryPrometheus,
  queryPrometheusRange,
} from '@/lib/prometheus';
import { METRICS_APP_LABEL } from '@/lib/metrics';
import { getSettings } from '@/lib/settings';
import {
  bridgeMode,
  fetchColibriStats,
  fetchJibriHealth,
  loadJvbDemand,
} from '@/lib/status/bridge';
import { activeOrUpcomingWhere, activeStatusWhere } from '@/lib/status/event-activity';
import { getJitsiHealth, type JitsiComponentHealth } from '@/lib/status/jitsi-health';
import { upSelector } from '@/lib/status/prometheus-selectors';

export const dynamic = 'force-dynamic';

/**
 * `unknown`: il componente non si può interrogare da qui (nessun indirizzo
 * interno, nessuna sonda) — né bene né male, «non monitorato».
 */
type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'standby' | 'scaling' | 'unknown';

interface ServiceNode {
  id: string;
  name: string;
  technicalName: string;
  description: string;
  status: ServiceStatus;
  verdict: string;
  impact: string | null;
  replicas: { running: number | null; desired: number | null; max: number | null };
  ports: { name: string; port: number; protocol: string }[];
  metadata: Record<string, string | number | boolean | null>;
}

interface Endpoint {
  host: string;
  port: number;
  protocol: string;
  tls: boolean;
  service: string;
  trafficRps: number | null;
}

interface StorageInfo {
  type: string;
  configured: boolean;
  recordings: { count: number; totalSizeBytes: number | null };
}

interface JvbExtendedStats {
  largestConference: number | null;
  rttAggregateMs: number | null;
  jitterAggregateMs: number | null;
  lossRateDownload: number | null;
  lossRateUpload: number | null;
  endpointsSendingAudio: number | null;
  endpointsSendingVideo: number | null;
  totalConferencesCreated: number | null;
  iceSuccessRate: number | null;
  // Octo (multi-bridge cascading). Non-zero values indicate the conference
  // is spread across multiple JVB pods and media is being relayed between
  // them. Reported from the single JVB pod the service LB routes us to.
  octoConferences: number | null;
  octoEndpoints: number | null;
  octoSendBitrateBps: number | null;
  octoReceiveBitrateBps: number | null;
}

interface AppProcessMetrics {
  cpuUsagePercent: number | null;
  memoryUsedMB: number | null;
  heapUsedMB: number | null;
  eventLoopLagMs: number | null;
  uptimeHours: number | null;
}

interface PrometheusData {
  available: boolean;
  uptime24h: number | null;
  uptime7d: number | null;
  // Latency percentiles over the last 5 minutes (ms).
  responseTimeP50: number | null;
  responseTimeP95: number | null;
  responseTimeP99: number | null;
  // 5xx error rate as a fraction of total requests over 5m.
  errorRate5m: number | null;
  // Total request rate in req/s over 5m.
  requestRate5m: number | null;
  // How long the oldest ready pod has been running (seconds).
  podUptimeSeconds: number | null;
  replicaCounts: Record<string, { running: number; desired: number }>;
  participantHistory: Array<[number, string]>;
}

export interface InfraMapData {
  cluster: {
    mode: 'simple' | 'standard' | 'full' | 'unknown';
    version: string;
    environment: string;
    namespace: string;
  };
  endpoints: Endpoint[];
  services: ServiceNode[];
  storage: StorageInfo;
  traffic: {
    totalParticipants: number;
    activeConferences: number;
    bandwidthInMbps: number | null;
    bandwidthOutMbps: number | null;
  };
  events: {
    active: number;
    registrationsToday: number;
    upcomingCount: number;
  };
  jvbExtended: JvbExtendedStats;
  appMetrics: AppProcessMetrics;
  prometheus: PrometheusData;
  overallVerdict: string;
  lastUpdated: string;
}

/** Lo stato di un componente di Jitsi nel vocabolario della mappa. */
function jitsiServiceStatus(health: JitsiComponentHealth, configured: boolean): ServiceStatus {
  if (!configured) return 'standby';
  switch (health.status) {
    case 'operational':
      return 'healthy';
    case 'degraded':
      return 'degraded';
    case 'outage':
      return 'down';
    default:
      return 'unknown';
  }
}

/**
 * Verdetto e conseguenza di un componente di Jitsi. Una verifica fallita
 * sull'indirizzo pubblico per certificato o nome non dice che le conferenze
 * non funzionano: dice che il server dell'applicazione non riesce a
 * verificarle.
 */
function jitsiVerdict(
  id: 'jitsiWeb' | 'prosody' | 'jicofo',
  health: JitsiComponentHealth,
  status: ServiceStatus,
): { verdict: string; impact: string | null } {
  if (status === 'standby') return { verdict: `infraMap.verdicts.${id}.standby`, impact: null };
  if (status === 'unknown') return { verdict: `infraMap.verdicts.${id}.unmonitored`, impact: null };
  if (status === 'healthy') return { verdict: `infraMap.verdicts.${id}.healthy`, impact: null };
  if (status === 'degraded') {
    return {
      verdict: health.publicCheckFailed
        ? `infraMap.verdicts.${id}.publicCheckFailed`
        : `infraMap.verdicts.${id}.degraded`,
      impact: null,
    };
  }
  return { verdict: `infraMap.verdicts.${id}.down`, impact: `infraMap.impacts.${id}` };
}

interface JvbFullStats {
  healthy: boolean;
  stressLevel: number | null;
  participants: number | null;
  conferences: number | null;
  videochannels: number | null;
  bitRateDown: number | null;
  bitRateUp: number | null;
  largestConference: number | null;
  rttAggregateMs: number | null;
  jitterAggregateMs: number | null;
  lossRateDownload: number | null;
  lossRateUpload: number | null;
  endpointsSendingAudio: number | null;
  endpointsSendingVideo: number | null;
  totalConferencesCreated: number | null;
  iceSucceeded: number | null;
  iceFailed: number | null;
  octoConferences: number | null;
  octoEndpoints: number | null;
  octoSendBitrateBps: number | null;
  octoReceiveBitrateBps: number | null;
}

const EMPTY_JVB: JvbFullStats = {
  healthy: false,
  stressLevel: null,
  participants: null,
  conferences: null,
  videochannels: null,
  bitRateDown: null,
  bitRateUp: null,
  largestConference: null,
  rttAggregateMs: null,
  jitterAggregateMs: null,
  lossRateDownload: null,
  lossRateUpload: null,
  endpointsSendingAudio: null,
  endpointsSendingVideo: null,
  totalConferencesCreated: null,
  iceSucceeded: null,
  iceFailed: null,
  octoConferences: null,
  octoEndpoints: null,
  octoSendBitrateBps: null,
  octoReceiveBitrateBps: null,
};


async function getJvbStats(): Promise<JvbFullStats> {
  // La stessa lettura di /api/status, riusata per qualche secondo.
  const s = await fetchColibriStats();
  if (!s) return { ...EMPTY_JVB };
  const num = (k: string) => typeof s[k] === 'number' ? s[k] as number : null;
  return {
    healthy: s.healthy !== false,
    stressLevel: num('stress_level'),
    participants: num('participants'),
    conferences: num('conferences'),
    videochannels: num('videochannels'),
    bitRateDown: num('bit_rate_download'),
    bitRateUp: num('bit_rate_upload'),
    largestConference: num('largest_conference'),
    rttAggregateMs: num('rtt_aggregate'),
    jitterAggregateMs: num('jitter_aggregate'),
    lossRateDownload: num('loss_rate_download'),
    lossRateUpload: num('loss_rate_upload'),
    endpointsSendingAudio: num('endpoints_sending_audio'),
    endpointsSendingVideo: num('endpoints_sending_video'),
    totalConferencesCreated: num('total_conferences_created'),
    iceSucceeded: num('total_ice_succeeded'),
    iceFailed: num('total_ice_failed'),
    octoConferences: num('octo_conferences'),
    octoEndpoints: num('octo_endpoints'),
    octoSendBitrateBps: num('octo_send_bitrate'),
    octoReceiveBitrateBps: num('octo_receive_bitrate'),
  };
}

async function getJibriInfo(): Promise<{
  healthy: boolean;
  busy: boolean;
  busyStatus: string | null;
}> {
  // Come /api/status: senza Jibri previsto non si interroga niente. Il chart
  // imposta l'indirizzo anche a Jibri spento, e un nome che non si risolve
  // costava secondi a ogni richiesta.
  if (!jibriRecordingExpected()) return { healthy: false, busy: false, busyStatus: null };
  const health = await fetchJibriHealth();
  if (!health) return { healthy: false, busy: false, busyStatus: null };
  return { healthy: health.healthy, busy: health.busyStatus === 'BUSY', busyStatus: health.busyStatus };
}

function computeIceSuccessRate(succeeded: number | null, failed: number | null): number | null {
  if (succeeded === null || failed === null) return null;
  const total = succeeded + failed;
  if (total === 0) return null;
  return Math.round((succeeded / total) * 10000) / 100;
}

async function fetchPrometheusData(namespace: string): Promise<PrometheusData> {
  const empty: PrometheusData = {
    available: false,
    uptime24h: null,
    uptime7d: null,
    responseTimeP50: null,
    responseTimeP95: null,
    responseTimeP99: null,
    errorRate5m: null,
    requestRate5m: null,
    podUptimeSeconds: null,
    replicaCounts: {},
    participantHistory: [],
  };

  if (!isPrometheusConfigured()) return empty;

  // Helper: aggregate multi-series results to a single scalar. Prometheus
  // returns one series per {pod,instance,method,route,status_code}, so we
  // sum (for counters) or average (for gauges/quantiles) across them.
  const firstScalar = (result: Array<{ value: [number, string] }> | undefined): number | null => {
    const first = result?.[0];
    if (!first) return null;
    const v = parseFloat(first.value[1]);
    return Number.isNaN(v) ? null : v;
  };

  const NS = namespace;
  const APP = METRICS_APP_LABEL;
  // `up` ha solo le etichette del bersaglio: si seleziona per job, come le
  // regole di allerta del chart (lib/status/prometheus-selectors).
  const UP = upSelector({ ...process.env, POD_NAMESPACE: namespace });
  // Uptime uses up{}. Quantiles go through `sum by (le)` so we collapse
  // all pods/routes before running the histogram_quantile — gives a single
  // meaningful number instead of one per label combination.
  const durationBucket = `http_request_duration_seconds_bucket{namespace="${NS}",app="${APP}"}`;
  const requestsTotal = `http_requests_total{namespace="${NS}",app="${APP}"}`;

  try {
    const [
      uptime24hRes,
      uptime7dRes,
      p50Res,
      p95Res,
      p99Res,
      errorRateRes,
      requestRateRes,
      podUptimeRes,
      participantsRes,
    ] = await Promise.all([
      queryPrometheus(`avg(avg_over_time(${UP}[24h])) * 100`).catch(() => null),
      queryPrometheus(`avg(avg_over_time(${UP}[7d])) * 100`).catch(() => null),
      queryPrometheus(`histogram_quantile(0.50, sum by (le) (rate(${durationBucket}[5m])))`).catch(() => null),
      queryPrometheus(`histogram_quantile(0.95, sum by (le) (rate(${durationBucket}[5m])))`).catch(() => null),
      queryPrometheus(`histogram_quantile(0.99, sum by (le) (rate(${durationBucket}[5m])))`).catch(() => null),
      queryPrometheus(`sum(rate(${requestsTotal.replace('}', ',status_code=~"5.."}')}[5m])) / clamp_min(sum(rate(${requestsTotal}[5m])), 0.001)`).catch(() => null),
      queryPrometheus(`sum(rate(${requestsTotal}[5m]))`).catch(() => null),
      queryPrometheus(`max(time() - process_start_time_seconds{namespace="${NS}",app="${APP}"})`).catch(() => null),
      queryPrometheusRange(
        `eventi_jvb_participants{namespace="${NS}"}`,
        String(Math.floor(Date.now() / 1000) - 4 * 3600),
        String(Math.floor(Date.now() / 1000)),
        '60',
      ).catch(() => null),
    ]);

    const scalarMs = (res: typeof uptime24hRes): number | null => {
      const v = firstScalar(res?.data?.result);
      return v === null ? null : Math.round(v * 1000);
    };
    const scalarPct = (res: typeof uptime24hRes): number | null => {
      const v = firstScalar(res?.data?.result);
      return v === null ? null : Math.round(v * 100) / 100;
    };

    let participantHistory: Array<[number, string]> = [];
    if (participantsRes?.data?.result?.[0]?.values) {
      participantHistory = participantsRes.data.result[0].values;
    }

    return {
      available: true,
      uptime24h: scalarPct(uptime24hRes),
      uptime7d: scalarPct(uptime7dRes),
      responseTimeP50: scalarMs(p50Res),
      responseTimeP95: scalarMs(p95Res),
      responseTimeP99: scalarMs(p99Res),
      errorRate5m: firstScalar(errorRateRes?.data?.result),
      requestRate5m: (() => {
        const v = firstScalar(requestRateRes?.data?.result);
        return v === null ? null : Math.round(v * 100) / 100;
      })(),
      podUptimeSeconds: (() => {
        const v = firstScalar(podUptimeRes?.data?.result);
        return v === null ? null : Math.round(v);
      })(),
      replicaCounts: {},
      participantHistory,
    };
  } catch {
    return empty;
  }
}

function inferEmailProvider(host: string): string {
  if (!host) return 'none';
  const h = host.toLowerCase();
  if (h.includes('mailgun')) return 'Mailgun';
  if (h.includes('sendgrid')) return 'SendGrid';
  if (h.includes('communication.azure')) return 'Azure ACS';
  if (h.includes('ses.')) return 'Amazon SES';
  if (h.includes('mailpit') || h.includes('localhost')) return 'Mailpit';
  return 'SMTP';
}

export const GET = withErrorHandling(async () => {
  // Pagina di stato spenta dall'amministrazione: questi dati servono solo a
  // lei e alla mappa dell'infrastruttura dell'area admin (lib/status-page).
  if (!(await statusDataVisible())) throw new NotFoundError('Status page');

  const mode = deploymentMode();
  const appDomain = getPublicEnv('NEXT_PUBLIC_APP_URL') || '';
  const settings = await getSettings();
  const provisioningTimeoutMinutes = settings.jvbProvisioningTimeoutMinutes ?? 15;
  // Lo storage: stessa regola della factory, tipo esplicito o credenziali.
  const storageType = recordingStorageLabel();
  const storageConfigured = recordingStorageConfigured();
  // Jibri: stessa regola di /api/status, solo con lo storage dichiarato
  // (lib/infrastructure#jibriRecordingExpected).
  const jibriExpected = jibriRecordingExpected();
  // Chi accende i bridge (lib/status/bridge): con lo scaler vale la lettura
  // scale-to-zero, senza il bridge risponde o no.
  const jvbMode = bridgeMode();
  const namespace = process.env.POD_NAMESPACE || 'default';
  const now = new Date();

  const [
    jitsiHealth,
    jvbStats,
    jvbSnapshot,
    jibriInfo,
    demand,
    activeEventCount,
    todayRegCount,
    upcomingCount,
    recordingCount,
    appMetricsRaw,
    prometheusData,
  ] = await Promise.all([
    getJitsiHealth(),
    getJvbStats(),
    // La fotografia la scrive solo lo scaler: senza, una rimasta in Redis
    // racconterebbe bridge di un'altra configurazione.
    jvbMode === 'scaler' ? readJvbSnapshot() : Promise.resolve(null),
    getJibriInfo(),
    loadJvbDemand(settings, now),
    // Una regola sola per i contatori (lib/status/event-activity): le
    // dirette anche oltre l'orario di fine.
    prisma.event.count({ where: activeStatusWhere('LIVE', now) }),
    prisma.registration.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.event.count({ where: activeOrUpcomingWhere(now) }),
    prisma.event.count({ where: { recordingUrl: { not: null } } }),
    getAppProcessMetrics(),
    fetchPrometheusData(namespace),
  ]);
  const jitsiDomain = jitsiHealth.domain;

  // The scaler CronJob polls every JVB pod individually (app pod lacks the
  // RBAC) and writes the per-tick aggregate here. When present it's the
  // source of truth for anything that depends on multi-pod numbers —
  // replica counts, participants, bitrate, conferences. A snapshot missing
  // these fields (older scaler image or every exec failed) falls back to
  // the single-pod /colibri/stats probe below.
  const snapshotHasTraffic = jvbSnapshot?.pollSuccesses !== undefined && jvbSnapshot.pollSuccesses > 0;

  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch { /* noop */ }

  // Redis ping for the infrastructure map. Kept side-by-side with the
  // database probe so both data-plane components share the same
  // failure surface. `redisConfigured = false` means the operator
  // is running single-pod (REDIS_URL unset) — we render the node
  // in 'standby' rather than 'down'.
  let redisConfigured = false;
  let redisOk = false;
  let redisLatencyMs = 0;
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (redis) {
      redisConfigured = true;
      const redisStart = Date.now();
      const pong = await Promise.race([
        redis.ping(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('redis timeout')), 2000),
        ),
      ]);
      redisLatencyMs = Date.now() - redisStart;
      redisOk = pong === 'PONG';
    }
  } catch { /* redisOk stays false */ }

  const staleCutoff = new Date(now.getTime() - provisioningTimeoutMinutes * 60 * 1000);
  // Same filter as /api/internal/jvb-desired-replicas: count LIVE,
  // PROVISIONING and PUBLISHED-within-pre-scale (lib/status/bridge).
  const soonEvents = demand.events;
  const maxJvb = demand.maxReplicas;
  const jvbDesired = demand.desired;

  // Running = status.readyReplicas from the Deployment (authoritative, written
  // by the scaler CronJob). `jvbStats.healthy` only tells us "≥1 pod answered
  // the Service VIP" and so collapses to 0 or 1 regardless of real replica
  // count — the bug this snapshot was introduced to fix.
  const jvbRunning = jvbSnapshot
    ? jvbSnapshot.ready
    : jvbStats.healthy ? 1 : 0;

  // Aggregated traffic (sum across pods) when the scaler provided it;
  // otherwise the single-pod jvbStats fallback.
  const aggregatedParticipants = snapshotHasTraffic
    ? jvbSnapshot!.participants ?? 0
    : jvbStats.participants ?? 0;
  const aggregatedConferences = snapshotHasTraffic
    ? jvbSnapshot!.conferences ?? 0
    : jvbStats.conferences ?? activeEventCount;
  // JVB reports bitrate in kbps; convert to Mbps for the UI.
  const aggregatedBitDownKbps = snapshotHasTraffic
    ? jvbSnapshot!.bitRateDownKbps ?? null
    : jvbStats.bitRateDown;
  const aggregatedBitUpKbps = snapshotHasTraffic
    ? jvbSnapshot!.bitRateUpKbps ?? null
    : jvbStats.bitRateUp;
  const aggregatedStress = snapshotHasTraffic
    ? jvbSnapshot!.stressLevel ?? jvbStats.stressLevel
    : jvbStats.stressLevel;
  const aggregatedLargestConf = snapshotHasTraffic
    ? jvbSnapshot!.largestConference ?? jvbStats.largestConference
    : jvbStats.largestConference;
  const aggregatedAudioSenders = snapshotHasTraffic
    ? jvbSnapshot!.endpointsSendingAudio ?? jvbStats.endpointsSendingAudio
    : jvbStats.endpointsSendingAudio;
  const aggregatedVideoSenders = snapshotHasTraffic
    ? jvbSnapshot!.endpointsSendingVideo ?? jvbStats.endpointsSendingVideo
    : jvbStats.endpointsSendingVideo;
  const aggregatedOctoConferences = snapshotHasTraffic
    ? jvbSnapshot!.octoConferences ?? jvbStats.octoConferences
    : jvbStats.octoConferences;
  const aggregatedOctoEndpoints = snapshotHasTraffic
    ? jvbSnapshot!.octoEndpoints ?? jvbStats.octoEndpoints
    : jvbStats.octoEndpoints;
  const aggregatedOctoSend = snapshotHasTraffic
    ? jvbSnapshot!.octoSendBitrateBps ?? jvbStats.octoSendBitrateBps
    : jvbStats.octoSendBitrateBps;
  const aggregatedOctoRecv = snapshotHasTraffic
    ? jvbSnapshot!.octoReceiveBitrateBps ?? jvbStats.octoReceiveBitrateBps
    : jvbStats.octoReceiveBitrateBps;

  // Stale-provisioning: an event with JVB_BILLABLE_STATUSES is waiting for a
  // bridge longer than the configured timeout. Reference timestamp is
  // provisioningStartedAt when set (populated by the scaler on PUBLISHED→
  // PROVISIONING transition) else startsAt (fallback for already-LIVE
  // events that skipped the provisioning phase). Only with a scaler: a fixed
  // bridge is up or down, nobody is "bringing it up".
  const billableEvents = soonEvents.filter((e) =>
    (JVB_BILLABLE_STATUSES as readonly string[]).includes(e.status),
  );
  const jvbStale = jvbMode === 'scaler' && jvbRunning < jvbDesired && billableEvents.some((e) => {
    const since = e.provisioningStartedAt ?? e.startsAt;
    return since <= staleCutoff;
  });

  // Jibri is "needed" only when a billable event has recording enabled.
  // Without a billable+recording event, Jibri can legitimately be at 0.
  const recordingEvents = billableEvents.filter((e) => e.recordingEnabled);
  const recordingNeeded = recordingEvents.length > 0;
  const jibriStale = jibriExpected && recordingNeeded && !jibriInfo.healthy && recordingEvents.some((e) => {
    const since = e.provisioningStartedAt ?? e.startsAt;
    return since <= staleCutoff;
  });

  // Il nodo del ponte video secondo chi lo accende (lib/status/bridge).
  let jvbStatus: ServiceStatus;
  let jvbVerdict: string;
  let jvbImpact: string | null = null;
  let jvbReplicas: ServiceNode['replicas'];
  if (jvbMode === 'scaler') {
    jvbStatus =
      jvbDesired === 0 ? 'standby'
        : jvbStale ? 'degraded'
          : jvbRunning >= jvbDesired ? 'healthy'
            : 'scaling';
    jvbVerdict = jvbStale
      ? 'infraMap.verdicts.jvb.stale'
      : jvbDesired === 0
        ? 'infraMap.verdicts.jvb.standby'
        : jvbRunning >= jvbDesired
          ? 'infraMap.verdicts.jvb.healthy'
          : 'infraMap.verdicts.jvb.scaling';
    jvbReplicas = { running: jvbRunning, desired: jvbDesired, max: maxJvb };
  } else if (jvbMode === 'fixed') {
    // Bridge fissi: risponde o no, a prescindere dagli eventi. Dietro un
    // Service ne risponde uno: il numero acceso è un limite inferiore, e le
    // barre delle repliche racconterebbero una scalata che non c'è.
    jvbStatus = jvbStats.healthy ? 'healthy' : 'down';
    jvbVerdict = jvbStats.healthy ? 'infraMap.verdicts.jvb.healthy' : 'infraMap.verdicts.jvb.fixedDown';
    jvbImpact = jvbStats.healthy ? null : 'infraMap.impacts.jvbDown';
    jvbReplicas = { running: jvbStats.healthy ? 1 : 0, desired: null, max: null };
  } else {
    jvbStatus = 'unknown';
    jvbVerdict = 'infraMap.verdicts.jvb.unmonitored';
    jvbReplicas = { running: null, desired: null, max: null };
  }

  const nextEventMin = soonEvents
    .filter(e => e.startsAt > now)
    .map(e => Math.round((e.startsAt.getTime() - now.getTime()) / 60_000))
    .sort((a, b) => a - b)[0] ?? null;

  let appHost = '';
  try { appHost = new URL(appDomain).hostname; } catch { /* */ }

  const dbStatus: ServiceStatus = dbOk ? (dbLatencyMs > 1000 ? 'degraded' : 'healthy') : 'down';
  // Redis is a required dependency for real-time chat fan-out.
  // A missing or unreachable Redis is reported as `down`, not `standby`,
  // because the chat fan-out feature is broken for the user.
  const redisStatus: ServiceStatus = redisConfigured && redisOk
    ? (redisLatencyMs > 500 ? 'degraded' : 'healthy')
    : 'down';
  // Ogni componente di Jitsi con la sua sonda (lib/status/jitsi-health).
  const jitsiConfigured = !!jitsiDomain;
  const jitsiWebStatus = jitsiServiceStatus(jitsiHealth.web, jitsiConfigured);
  const prosodyStatus = jitsiServiceStatus(jitsiHealth.prosody, jitsiConfigured);
  const jicofoStatus = jitsiServiceStatus(jitsiHealth.jicofo, jitsiConfigured);
  const jitsiWebVerdict = jitsiVerdict('jitsiWeb', jitsiHealth.web, jitsiWebStatus);
  const prosodyVerdict = jitsiVerdict('prosody', jitsiHealth.prosody, prosodyStatus);
  const jicofoVerdict = jitsiVerdict('jicofo', jitsiHealth.jicofo, jicofoStatus);
  const runningIf = (status: ServiceStatus): number | null =>
    status === 'unknown' ? null : status === 'healthy' || status === 'degraded' ? 1 : 0;
  // Jibri status reflects scale-to-zero semantics, mirroring /api/status:
  //   - unconfigured (Jibri not expected)  → standby with unconfigured verdict
  //   - healthy pod reachable              → healthy / busy
  //   - no pod but nothing needs recording → standby (scale-to-zero normal)
  //   - no pod but a billable+recording event waits past timeout → degraded (stale)
  //   - no pod but something needs recording, not yet stale → scaling
  const jibriStatus: ServiceStatus = !jibriExpected
    ? 'standby'
    : jibriInfo.healthy
      ? 'healthy'
      : jibriStale
        ? 'degraded'
        : recordingNeeded
          ? 'scaling'
          : 'standby';
  const smtpStatus: ServiceStatus = process.env.SMTP_HOST ? 'healthy' : 'standby';

  const services: ServiceNode[] = [
    {
      id: 'app',
      name: 'infraMap.services.app',
      technicalName: `Next.js / Node.js ${process.version}`,
      description: 'infraMap.descriptions.app',
      status: 'healthy',
      verdict: 'infraMap.verdicts.app.healthy',
      impact: null,
      // Quante repliche dell'applicazione girano lo sa il Deployment, che
      // da qui non si legge: meglio nessun numero che uno inventato.
      replicas: { running: null, desired: null, max: null },
      ports: [{ name: 'http', port: 3000, protocol: 'TCP' }],
      metadata: { runtime: `Node.js ${process.version}`, uptimeHours: appMetricsRaw.uptimeHours, heapUsedMB: appMetricsRaw.heapUsedMB, eventLoopLagMs: appMetricsRaw.eventLoopLagMs },
    },
    {
      id: 'database',
      name: 'infraMap.services.database',
      technicalName: 'PostgreSQL',
      description: 'infraMap.descriptions.database',
      status: dbStatus,
      verdict: dbOk
        ? (dbLatencyMs > 1000 ? 'infraMap.verdicts.database.degraded' : 'infraMap.verdicts.database.healthy')
        : 'infraMap.verdicts.database.down',
      impact: dbOk ? null : 'infraMap.impacts.database',
      replicas: { running: dbOk ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'postgresql', port: 5432, protocol: 'TCP' }],
      metadata: { type: databaseBundled() ? 'in-cluster' : 'external', latencyMs: dbLatencyMs },
    },
    {
      id: 'redis',
      name: 'infraMap.services.redis',
      technicalName: 'Redis (pub/sub)',
      description: 'infraMap.descriptions.redis',
      status: redisStatus,
      verdict: redisConfigured && redisOk
        ? (redisLatencyMs > 500 ? 'infraMap.verdicts.redis.degraded' : 'infraMap.verdicts.redis.healthy')
        : 'infraMap.verdicts.redis.down',
      impact: redisConfigured && redisOk ? null : 'infraMap.impacts.redis',
      replicas: { running: redisOk ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'redis', port: 6379, protocol: 'TCP' }],
      metadata: { configured: redisConfigured, latencyMs: redisLatencyMs },
    },
    {
      id: 'jitsi-web',
      name: 'infraMap.services.jitsiWeb',
      technicalName: 'Jitsi Meet Web',
      description: 'infraMap.descriptions.jitsiWeb',
      status: jitsiWebStatus,
      verdict: jitsiWebVerdict.verdict,
      impact: jitsiWebVerdict.impact,
      replicas: { running: runningIf(jitsiWebStatus), desired: null, max: null },
      ports: [{ name: 'https', port: 443, protocol: 'TCP' }],
      metadata: {
        domain: jitsiDomain,
        responseMs: jitsiHealth.web.responseMs,
        probe: jitsiHealth.web.via,
        probeDetail: jitsiHealth.web.details ?? null,
      },
    },
    {
      id: 'prosody',
      name: 'infraMap.services.prosody',
      technicalName: 'Prosody (XMPP)',
      description: 'infraMap.descriptions.prosody',
      status: prosodyStatus,
      verdict: prosodyVerdict.verdict,
      impact: prosodyVerdict.impact,
      replicas: { running: runningIf(prosodyStatus), desired: null, max: null },
      ports: [
        { name: 'xmpp-c2s', port: 5222, protocol: 'TCP' },
        { name: 'xmpp-s2s', port: 5269, protocol: 'TCP' },
        { name: 'bosh', port: 5280, protocol: 'TCP' },
      ],
      metadata: {
        responseMs: jitsiHealth.prosody.responseMs,
        probe: jitsiHealth.prosody.via,
        probeDetail: jitsiHealth.prosody.details ?? null,
      },
    },
    {
      id: 'jicofo',
      name: 'infraMap.services.jicofo',
      technicalName: 'Jicofo (Focus Component)',
      description: 'infraMap.descriptions.jicofo',
      status: jicofoStatus,
      verdict: jicofoVerdict.verdict,
      impact: jicofoVerdict.impact,
      replicas: { running: runningIf(jicofoStatus), desired: null, max: null },
      ports: [{ name: 'http', port: 8888, protocol: 'TCP' }],
      metadata: {
        responseMs: jitsiHealth.jicofo.responseMs,
        probe: jitsiHealth.jicofo.via,
        probeDetail: jitsiHealth.jicofo.details ?? null,
      },
    },
    {
      id: 'jvb',
      name: 'infraMap.services.jvb',
      technicalName: 'Jitsi Videobridge (JVB)',
      description: 'infraMap.descriptions.jvb',
      status: jvbStatus,
      verdict: jvbVerdict,
      impact: jvbImpact
        ?? (jvbStale
          ? 'infraMap.impacts.jvbStale'
          : jvbStatus === 'scaling' && nextEventMin !== null
            ? 'infraMap.impacts.jvbScaling'
            : null),
      replicas: jvbReplicas,
      ports: [
        { name: 'media', port: 10000, protocol: 'UDP' },
        { name: 'colibri', port: 8080, protocol: 'TCP' },
      ],
      metadata: {
        mode: jvbMode,
        stressLevel: aggregatedStress,
        participants: aggregatedParticipants,
        conferences: aggregatedConferences,
        videochannels: jvbStats.videochannels,
        nextEventMin,
      },
    },
    {
      id: 'jibri',
      name: 'infraMap.services.jibri',
      technicalName: 'Jibri (Jitsi Broadcasting Infrastructure)',
      description: 'infraMap.descriptions.jibri',
      status: jibriStatus,
      // Verdict mirrors the status: unconfigured → unconfigured, healthy →
      // healthy/busy, stale → stale, needed-but-scaling → (fall back to
      // 'standby' which already explains scale-to-zero), normal idle →
      // standby. The only "down" case is when storage IS configured AND
      // a billable+recording event has been waiting past the timeout —
      // which is the 'stale' verdict.
      verdict: !jibriExpected
        ? 'infraMap.verdicts.jibri.unconfigured'
        : jibriInfo.healthy
          ? (jibriInfo.busy ? 'infraMap.verdicts.jibri.busy' : 'infraMap.verdicts.jibri.healthy')
          : jibriStale
            ? 'infraMap.verdicts.jibri.stale'
            : 'infraMap.verdicts.jibri.standby',
      impact: jibriExpected && jibriStale ? 'infraMap.impacts.jibriStale' : null,
      replicas: { running: jibriInfo.healthy ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'api', port: 2222, protocol: 'TCP' }],
      metadata: {
        busy: jibriInfo.busy,
        busyStatus: jibriInfo.busyStatus,
        storageConfigured: jibriExpected,
        recordingNeeded,
      },
    },
    {
      id: 'smtp',
      name: 'infraMap.services.smtp',
      technicalName: `SMTP (${inferEmailProvider(process.env.SMTP_HOST || '')})`,
      description: 'infraMap.descriptions.smtp',
      status: smtpStatus,
      verdict: process.env.SMTP_HOST
        ? 'infraMap.verdicts.smtp.healthy'
        : 'infraMap.verdicts.smtp.standby',
      impact: smtpStatus === 'standby' ? 'infraMap.impacts.smtp' : null,
      replicas: { running: process.env.SMTP_HOST ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'smtp', port: parseInt(process.env.SMTP_PORT || '587', 10), protocol: 'TCP' }],
      metadata: { provider: inferEmailProvider(process.env.SMTP_HOST || ''), external: true },
    },
  ];

  // Postprod AI pipeline — aggiunto al map SOLO quando l'admin ha
  // abilitato la feature. Senza questo gate, ogni installazione del
  // chart vedrebbe un nodo "AI postprod" anche se non ha mai
  // configurato il GPU pool + GPU Operator. Graceful degradation: la
  // UI vede il nodo apparire/scomparire dinamicamente sul toggle.
  if (settings.aiPipelineEnabled) {
    const postprodStats = await prisma.$queryRaw<
      Array<{ status: string; count: bigint }>
    >`SELECT status::text, COUNT(*)::bigint FROM postprod_jobs GROUP BY status`;

    const counts = {
      PENDING: 0,
      CLAIMED: 0,
      RUNNING: 0,
      DONE: 0,
      FAILED: 0,
    } satisfies Record<string, number>;
    for (const r of postprodStats) {
      if (r.status in counts) {
        (counts as Record<string, number>)[r.status] = Number(r.count);
      }
    }

    const failed24h = await prisma.postprodJob.count({
      where: {
        status: 'FAILED',
        completedAt: { gte: new Date(Date.now() - 24 * 3600_000) },
      },
    });

    const claimedOrRunning = counts.CLAIMED + counts.RUNNING;
    const postprodStatus: ServiceStatus = failed24h > 0
      ? 'degraded'
      : claimedOrRunning > 0
        ? 'healthy'
        : counts.PENDING > 0
          ? 'scaling'
          : 'standby';

    services.push({
      id: 'postprod',
      name: 'infraMap.services.postprod',
      technicalName: `AI postprod (${settings.aiAsrProvider}+${settings.aiLlmProvider})`,
      description: 'infraMap.descriptions.postprod',
      status: postprodStatus,
      verdict:
        failed24h > 0
          ? 'infraMap.verdicts.postprod.degraded'
          : claimedOrRunning > 0
            ? 'infraMap.verdicts.postprod.healthy'
            : counts.PENDING > 0
              ? 'infraMap.verdicts.postprod.scaling'
              : 'infraMap.verdicts.postprod.standby',
      impact: failed24h > 0 ? 'infraMap.impacts.postprodDegraded' : null,
      replicas: {
        running: claimedOrRunning,
        desired: counts.PENDING + claimedOrRunning,
        max: settings.aiMaxConcurrentJobs,
      },
      // La pipeline non espone porte HTTP pubbliche (i worker parlano
      // con l'app via API interna, non viceversa). Manteniamo l'array
      // popolato per coerenza UI ma con la porta vLLM in-cluster.
      ports: [{ name: 'vllm', port: 8000, protocol: 'TCP' }],
      metadata: {
        llmProvider: settings.aiLlmProvider,
        asrProvider: settings.aiAsrProvider,
        nodePool: 'ai-gpu',
        pendingJobs: counts.PENDING,
        claimedJobs: counts.CLAIMED,
        runningJobs: counts.RUNNING,
        doneJobs: counts.DONE,
        failedJobs: counts.FAILED,
        failed24h,
        artifactRetentionDays: settings.aiArtifactRetentionDays,
      },
    });
  }

  const endpoints: Endpoint[] = [];
  if (appHost) {
    endpoints.push({ host: appHost, port: 443, protocol: 'HTTPS', tls: true, service: 'app', trafficRps: null });
  }
  if (jitsiDomain) {
    endpoints.push({ host: jitsiDomain, port: 443, protocol: 'HTTPS', tls: true, service: 'jitsi-web', trafficRps: null });
    endpoints.push({ host: jitsiDomain, port: 10000, protocol: 'UDP', tls: false, service: 'jvb', trafficRps: null });
  }

  const bitRateDownMbps = aggregatedBitDownKbps !== null && aggregatedBitDownKbps !== undefined
    ? aggregatedBitDownKbps / 1024
    : null;
  const bitRateUpMbps = aggregatedBitUpKbps !== null && aggregatedBitUpKbps !== undefined
    ? aggregatedBitUpKbps / 1024
    : null;

  const hasDownService = services.some(s => s.status === 'down');
  const hasDegradedService = services.some(s => s.status === 'degraded');
  const overallVerdict = hasDownService
    ? 'infraMap.overallVerdicts.outage'
    : hasDegradedService
      ? 'infraMap.overallVerdicts.degraded'
      : 'infraMap.overallVerdicts.operational';

  const data: InfraMapData = {
    cluster: {
      mode,
      // La stessa versione di /api/health, letta a runtime.
      version: getPublicEnv('NEXT_PUBLIC_BUILD_VERSION') || process.env.APP_VERSION || '',
      environment: process.env.NODE_ENV || 'development',
      namespace,
    },
    endpoints,
    services,
    storage: {
      type: storageType,
      configured: storageConfigured,
      recordings: { count: recordingCount, totalSizeBytes: null },
    },
    traffic: {
      totalParticipants: aggregatedParticipants,
      activeConferences: aggregatedConferences,
      bandwidthInMbps: bitRateDownMbps,
      bandwidthOutMbps: bitRateUpMbps,
    },
    events: {
      active: activeEventCount,
      registrationsToday: todayRegCount,
      upcomingCount,
    },
    jvbExtended: {
      largestConference: aggregatedLargestConf ?? null,
      // RTT/jitter/loss and ICE totals aren't meaningfully summable across
      // pods (they're per-pod aggregates already) and the scaler doesn't
      // forward them. Keep the single-pod view — still correct when only
      // one JVB is hot, informative-but-partial when multiple are.
      rttAggregateMs: jvbStats.rttAggregateMs,
      jitterAggregateMs: jvbStats.jitterAggregateMs,
      lossRateDownload: jvbStats.lossRateDownload,
      lossRateUpload: jvbStats.lossRateUpload,
      endpointsSendingAudio: aggregatedAudioSenders ?? null,
      endpointsSendingVideo: aggregatedVideoSenders ?? null,
      totalConferencesCreated: jvbStats.totalConferencesCreated,
      iceSuccessRate: computeIceSuccessRate(jvbStats.iceSucceeded, jvbStats.iceFailed),
      octoConferences: aggregatedOctoConferences ?? null,
      octoEndpoints: aggregatedOctoEndpoints ?? null,
      octoSendBitrateBps: aggregatedOctoSend ?? null,
      octoReceiveBitrateBps: aggregatedOctoRecv ?? null,
    },
    appMetrics: appMetricsRaw,
    prometheus: prometheusData,
    overallVerdict,
    lastUpdated: new Date().toISOString(),
  };

  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
});
