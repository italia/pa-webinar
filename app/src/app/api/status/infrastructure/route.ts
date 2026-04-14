import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getAppProcessMetrics } from '@/lib/metrics';
import {
  isPrometheusConfigured,
  queryPrometheus,
  queryPrometheusRange,
} from '@/lib/prometheus';

export const dynamic = 'force-dynamic';

type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'standby' | 'scaling';

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
  responseTimeP95: number | null;
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

function inferDeploymentMode(): InfraMapData['cluster']['mode'] {
  if (process.env.KUBERNETES_SERVICE_HOST) {
    const maxReplicas = parseInt(process.env.JVB_MAX_REPLICAS || '0', 10);
    return maxReplicas > 1 ? 'full' : 'standard';
  }
  return 'simple';
}

async function probeService(
  url: string,
  timeoutMs = 3000,
): Promise<{ ok: boolean; responseMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok || res.status === 405, responseMs: Date.now() - start };
  } catch {
    return { ok: false, responseMs: Date.now() - start };
  }
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
};

async function getJvbStats(): Promise<JvbFullStats> {
  const url = process.env.JVB_HEALTH_URL;
  if (!url) return { ...EMPTY_JVB };

  try {
    const res = await fetch(`${url}/colibri/stats`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ...EMPTY_JVB };

    const s = await res.json() as Record<string, unknown>;
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
    };
  } catch {
    return { ...EMPTY_JVB };
  }
}

async function getJibriInfo(): Promise<{
  healthy: boolean;
  busy: boolean;
  busyStatus: string | null;
}> {
  const url = process.env.JIBRI_HEALTH_URL;
  if (!url) return { healthy: false, busy: false, busyStatus: null };

  try {
    const res = await fetch(`${url}/jibri/api/v1.0/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { healthy: false, busy: false, busyStatus: null };

    const data = await res.json() as {
      status?: { busyStatus?: string; health?: { healthStatus?: string } };
    };
    const healthy = data.status?.health?.healthStatus === 'HEALTHY';
    const busyStatus = data.status?.busyStatus ?? null;
    return { healthy, busy: busyStatus === 'BUSY', busyStatus };
  } catch {
    return { healthy: false, busy: false, busyStatus: null };
  }
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
    responseTimeP95: null,
    replicaCounts: {},
    participantHistory: [],
  };

  if (!isPrometheusConfigured()) return empty;

  try {
    const [uptimeRes, latencyRes, participantsRes] = await Promise.all([
      queryPrometheus(`avg_over_time(up{namespace="${namespace}",job=~".*eventi.*"}[24h]) * 100`).catch(() => null),
      queryPrometheus(`histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{namespace="${namespace}",app="eventi-dtd"}[5m]))`).catch(() => null),
      queryPrometheusRange(
        `eventi_jvb_participants{namespace="${namespace}"}`,
        String(Math.floor(Date.now() / 1000) - 4 * 3600),
        String(Math.floor(Date.now() / 1000)),
        '60',
      ).catch(() => null),
    ]);

    let uptime24h: number | null = null;
    if (uptimeRes?.data?.result?.[0]) {
      uptime24h = Math.round(parseFloat(uptimeRes.data.result[0].value[1]) * 100) / 100;
    }

    let responseTimeP95: number | null = null;
    if (latencyRes?.data?.result?.[0]) {
      responseTimeP95 = Math.round(parseFloat(latencyRes.data.result[0].value[1]) * 1000);
    }

    let participantHistory: Array<[number, string]> = [];
    if (participantsRes?.data?.result?.[0]?.values) {
      participantHistory = participantsRes.data.result[0].values;
    }

    return {
      available: true,
      uptime24h,
      responseTimeP95,
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
  const mode = inferDeploymentMode();
  const jitsiDomain = getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN') || '';
  const appDomain = getPublicEnv('NEXT_PUBLIC_APP_URL') || '';
  const maxJvb = parseInt(process.env.JVB_MAX_REPLICAS || '6', 10);
  const preScaleMinutes = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
  const storageType = process.env.RECORDING_STORAGE_TYPE || 'not-configured';
  const namespace = process.env.POD_NAMESPACE || 'default';

  const [
    jitsiProbe,
    jvbStats,
    jibriInfo,
    activeEventCount,
    todayRegCount,
    upcomingCount,
    recordingCount,
    appMetricsRaw,
    prometheusData,
  ] = await Promise.all([
    jitsiDomain ? probeService(`${jitsiDomain.includes('localhost') ? 'http' : 'https'}://${jitsiDomain}/external_api.js`, 5000) : Promise.resolve({ ok: false, responseMs: 0 }),
    getJvbStats(),
    getJibriInfo(),
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.registration.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.event.count({ where: { status: { in: ['PUBLISHED', 'LIVE'] }, endsAt: { gte: new Date() } } }),
    prisma.event.count({ where: { recordingUrl: { not: null } } }),
    getAppProcessMetrics(),
    fetchPrometheusData(namespace),
  ]);

  let dbOk = false;
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbOk = true;
  } catch { /* noop */ }

  const now = new Date();
  const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);
  const soonEvents = await prisma.event.findMany({
    where: {
      OR: [
        { status: 'LIVE' },
        { status: 'PUBLISHED', startsAt: { lte: preScaleWindow }, endsAt: { gte: now } },
      ],
    },
    select: { maxParticipants: true, participantsCanStartVideo: true, startsAt: true },
  });

  let jvbDesired = 0;
  for (const ev of soonEvents) {
    const videoEnabled = ev.participantsCanStartVideo;
    if (videoEnabled) {
      jvbDesired += ev.maxParticipants <= 150 ? 1 : ev.maxParticipants <= 350 ? 2 : Math.ceil(ev.maxParticipants / 150);
    } else {
      jvbDesired += ev.maxParticipants <= 500 ? 1 : Math.ceil(ev.maxParticipants / 500);
    }
  }
  jvbDesired = Math.min(jvbDesired, maxJvb);
  if (soonEvents.length > 0 && jvbDesired === 0) jvbDesired = 1;

  const jvbRunning = jvbStats.healthy ? 1 : 0;
  const jvbStatus: ServiceStatus =
    jvbDesired === 0 ? 'standby'
      : jvbRunning >= jvbDesired ? 'healthy'
        : 'scaling';

  const nextEventMin = soonEvents
    .filter(e => e.startsAt > now)
    .map(e => Math.round((e.startsAt.getTime() - now.getTime()) / 60_000))
    .sort((a, b) => a - b)[0] ?? null;

  let appHost = '';
  try { appHost = new URL(appDomain).hostname; } catch { /* */ }

  const dbStatus: ServiceStatus = dbOk ? (dbLatencyMs > 1000 ? 'degraded' : 'healthy') : 'down';
  const jitsiWebStatus: ServiceStatus = jitsiProbe.ok ? 'healthy' : jitsiDomain ? 'down' : 'standby';
  const jibriStatus: ServiceStatus = jibriInfo.healthy ? 'healthy' : storageType !== 'not-configured' ? 'down' : 'standby';
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
      replicas: { running: 1, desired: null, max: null },
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
      metadata: { type: mode === 'simple' ? 'in-cluster' : 'external', latencyMs: dbLatencyMs },
    },
    {
      id: 'jitsi-web',
      name: 'infraMap.services.jitsiWeb',
      technicalName: 'Jitsi Meet Web',
      description: 'infraMap.descriptions.jitsiWeb',
      status: jitsiWebStatus,
      verdict: jitsiProbe.ok
        ? 'infraMap.verdicts.jitsiWeb.healthy'
        : jitsiDomain ? 'infraMap.verdicts.jitsiWeb.down' : 'infraMap.verdicts.jitsiWeb.standby',
      impact: jitsiWebStatus === 'down' ? 'infraMap.impacts.jitsiWeb' : null,
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'https', port: 443, protocol: 'TCP' }],
      metadata: { domain: jitsiDomain, responseMs: jitsiProbe.responseMs },
    },
    {
      id: 'prosody',
      name: 'infraMap.services.prosody',
      technicalName: 'Prosody (XMPP)',
      description: 'infraMap.descriptions.prosody',
      status: jitsiWebStatus,
      verdict: jitsiProbe.ok
        ? 'infraMap.verdicts.prosody.healthy'
        : jitsiDomain ? 'infraMap.verdicts.prosody.down' : 'infraMap.verdicts.prosody.standby',
      impact: jitsiWebStatus === 'down' ? 'infraMap.impacts.prosody' : null,
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: null, max: null },
      ports: [
        { name: 'xmpp-c2s', port: 5222, protocol: 'TCP' },
        { name: 'xmpp-s2s', port: 5269, protocol: 'TCP' },
        { name: 'bosh', port: 5280, protocol: 'TCP' },
      ],
      metadata: {},
    },
    {
      id: 'jicofo',
      name: 'infraMap.services.jicofo',
      technicalName: 'Jicofo (Focus Component)',
      description: 'infraMap.descriptions.jicofo',
      status: jitsiWebStatus,
      verdict: jitsiProbe.ok
        ? 'infraMap.verdicts.jicofo.healthy'
        : jitsiDomain ? 'infraMap.verdicts.jicofo.down' : 'infraMap.verdicts.jicofo.standby',
      impact: jitsiWebStatus === 'down' ? 'infraMap.impacts.jicofo' : null,
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'http', port: 8888, protocol: 'TCP' }],
      metadata: {},
    },
    {
      id: 'jvb',
      name: 'infraMap.services.jvb',
      technicalName: 'Jitsi Videobridge (JVB)',
      description: 'infraMap.descriptions.jvb',
      status: jvbStatus,
      verdict: jvbDesired === 0
        ? 'infraMap.verdicts.jvb.standby'
        : jvbRunning >= jvbDesired
          ? 'infraMap.verdicts.jvb.healthy'
          : 'infraMap.verdicts.jvb.scaling',
      impact: jvbStatus === 'scaling' && nextEventMin !== null
        ? 'infraMap.impacts.jvbScaling'
        : null,
      replicas: { running: jvbRunning, desired: jvbDesired, max: maxJvb },
      ports: [
        { name: 'media', port: 10000, protocol: 'UDP' },
        { name: 'colibri', port: 8080, protocol: 'TCP' },
      ],
      metadata: {
        stressLevel: jvbStats.stressLevel,
        participants: jvbStats.participants,
        conferences: jvbStats.conferences,
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
      verdict: jibriInfo.healthy
        ? (jibriInfo.busy ? 'infraMap.verdicts.jibri.busy' : 'infraMap.verdicts.jibri.healthy')
        : storageType !== 'not-configured' ? 'infraMap.verdicts.jibri.down' : 'infraMap.verdicts.jibri.standby',
      impact: jibriStatus === 'down' ? 'infraMap.impacts.jibri' : null,
      replicas: { running: jibriInfo.healthy ? 1 : 0, desired: null, max: null },
      ports: [{ name: 'api', port: 2222, protocol: 'TCP' }],
      metadata: { busy: jibriInfo.busy, busyStatus: jibriInfo.busyStatus },
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

  const endpoints: Endpoint[] = [];
  if (appHost) {
    endpoints.push({ host: appHost, port: 443, protocol: 'HTTPS', tls: true, service: 'app', trafficRps: null });
  }
  if (jitsiDomain) {
    endpoints.push({ host: jitsiDomain, port: 443, protocol: 'HTTPS', tls: true, service: 'jitsi-web', trafficRps: null });
    endpoints.push({ host: jitsiDomain, port: 10000, protocol: 'UDP', tls: false, service: 'jvb', trafficRps: null });
  }

  const bitRateDownMbps = jvbStats.bitRateDown !== null ? jvbStats.bitRateDown / 1024 : null;
  const bitRateUpMbps = jvbStats.bitRateUp !== null ? jvbStats.bitRateUp / 1024 : null;

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
      version: process.env.npm_package_version || process.env.APP_VERSION || '0.0.0',
      environment: process.env.NODE_ENV || 'development',
      namespace,
    },
    endpoints,
    services,
    storage: {
      type: storageType,
      configured: storageType !== 'not-configured' && storageType !== 'local',
      recordings: { count: recordingCount, totalSizeBytes: null },
    },
    traffic: {
      totalParticipants: jvbStats.participants ?? 0,
      activeConferences: jvbStats.conferences ?? activeEventCount,
      bandwidthInMbps: bitRateDownMbps,
      bandwidthOutMbps: bitRateUpMbps,
    },
    events: {
      active: activeEventCount,
      registrationsToday: todayRegCount,
      upcomingCount,
    },
    jvbExtended: {
      largestConference: jvbStats.largestConference,
      rttAggregateMs: jvbStats.rttAggregateMs,
      jitterAggregateMs: jvbStats.jitterAggregateMs,
      lossRateDownload: jvbStats.lossRateDownload,
      lossRateUpload: jvbStats.lossRateUpload,
      endpointsSendingAudio: jvbStats.endpointsSendingAudio,
      endpointsSendingVideo: jvbStats.endpointsSendingVideo,
      totalConferencesCreated: jvbStats.totalConferencesCreated,
      iceSuccessRate: computeIceSuccessRate(jvbStats.iceSucceeded, jvbStats.iceFailed),
    },
    appMetrics: appMetricsRaw,
    prometheus: prometheusData,
    overallVerdict,
    lastUpdated: new Date().toISOString(),
  };

  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
});
