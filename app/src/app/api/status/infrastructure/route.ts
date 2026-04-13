import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

interface ServiceNode {
  id: string;
  name: string;
  status: 'healthy' | 'degraded' | 'down' | 'standby' | 'scaling';
  replicas: { running: number; desired: number; max: number };
  resources: {
    cpuRequest: string;
    memRequest: string;
    cpuUsage: number | null;
    memUsage: number | null;
  };
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

interface NodePoolInfo {
  name: string;
  nodeCount: number;
  minNodes: number;
  maxNodes: number;
  status: 'active' | 'idle' | 'scaling' | 'scaled-to-zero';
  instanceType: string;
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
  nodePools: NodePoolInfo[];
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

async function getJvbStats(): Promise<{
  healthy: boolean;
  stressLevel: number | null;
  participants: number | null;
  conferences: number | null;
  videochannels: number | null;
  bitRateDown: number | null;
  bitRateUp: number | null;
}> {
  const url = process.env.JVB_HEALTH_URL;
  if (!url) return { healthy: false, stressLevel: null, participants: null, conferences: null, videochannels: null, bitRateDown: null, bitRateUp: null };

  try {
    const res = await fetch(`${url}/colibri/stats`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { healthy: false, stressLevel: null, participants: null, conferences: null, videochannels: null, bitRateDown: null, bitRateUp: null };

    const stats = await res.json() as Record<string, unknown>;
    return {
      healthy: stats.healthy !== false,
      stressLevel: typeof stats.stress_level === 'number' ? stats.stress_level : null,
      participants: typeof stats.participants === 'number' ? stats.participants : null,
      conferences: typeof stats.conferences === 'number' ? stats.conferences : null,
      videochannels: typeof stats.videochannels === 'number' ? stats.videochannels : null,
      bitRateDown: typeof stats.bit_rate_download === 'number' ? stats.bit_rate_download : null,
      bitRateUp: typeof stats.bit_rate_upload === 'number' ? stats.bit_rate_upload : null,
    };
  } catch {
    return { healthy: false, stressLevel: null, participants: null, conferences: null, videochannels: null, bitRateDown: null, bitRateUp: null };
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

export const GET = withErrorHandling(async () => {
  const mode = inferDeploymentMode();
  const jitsiDomain = getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN') || '';
  const appDomain = getPublicEnv('NEXT_PUBLIC_APP_URL') || '';
  const maxJvb = parseInt(process.env.JVB_MAX_REPLICAS || '6', 10);
  const preScaleMinutes = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
  const storageType = process.env.RECORDING_STORAGE_TYPE || 'not-configured';

  const [
    ,
    jitsiProbe,
    jvbStats,
    jibriInfo,
    activeEventCount,
    todayRegCount,
    upcomingCount,
    recordingCount,
  ] = await Promise.all([
    Promise.resolve(null),
    jitsiDomain ? probeService(`${jitsiDomain.includes('localhost') ? 'http' : 'https'}://${jitsiDomain}/external_api.js`, 5000) : Promise.resolve({ ok: false, responseMs: 0 }),
    getJvbStats(),
    getJibriInfo(),
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.registration.count({ where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } } }),
    prisma.event.count({ where: { status: { in: ['PUBLISHED', 'LIVE'] }, endsAt: { gte: new Date() } } }),
    prisma.event.count({ where: { recordingUrl: { not: null } } }),
  ]);

  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
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
    select: { maxParticipants: true, participantsCanStartVideo: true },
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
  const jvbStatus: ServiceNode['status'] =
    jvbDesired === 0 ? 'standby'
      : jvbRunning >= jvbDesired ? 'healthy'
        : 'scaling';

  let appHost = '';
  try { appHost = new URL(appDomain).hostname; } catch { /* */ }

  const services: ServiceNode[] = [
    {
      id: 'app',
      name: 'App (Next.js)',
      status: 'healthy',
      replicas: { running: parseInt(process.env.APP_REPLICAS || '1', 10), desired: parseInt(process.env.APP_REPLICAS || '1', 10), max: parseInt(process.env.APP_MAX_REPLICAS || '4', 10) },
      resources: { cpuRequest: '250m', memRequest: '512Mi', cpuUsage: null, memUsage: null },
      ports: [{ name: 'http', port: 3000, protocol: 'TCP' }],
      metadata: { framework: 'Next.js 15', runtime: 'Node.js' },
    },
    {
      id: 'database',
      name: 'PostgreSQL',
      status: dbOk ? 'healthy' : 'down',
      replicas: { running: dbOk ? 1 : 0, desired: 1, max: 1 },
      resources: { cpuRequest: '500m', memRequest: '1Gi', cpuUsage: null, memUsage: null },
      ports: [{ name: 'postgresql', port: 5432, protocol: 'TCP' }],
      metadata: { version: '16', type: mode === 'simple' ? 'in-cluster' : 'external' },
    },
    {
      id: 'jitsi-web',
      name: 'Jitsi Web',
      status: jitsiProbe.ok ? 'healthy' : jitsiDomain ? 'down' : 'standby',
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: 1, max: 1 },
      resources: { cpuRequest: '100m', memRequest: '256Mi', cpuUsage: null, memUsage: null },
      ports: [{ name: 'https', port: 443, protocol: 'TCP' }],
      metadata: { domain: jitsiDomain, responseMs: jitsiProbe.responseMs },
    },
    {
      id: 'prosody',
      name: 'Prosody (XMPP)',
      status: jitsiProbe.ok ? 'healthy' : jitsiDomain ? 'down' : 'standby',
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: 1, max: 1 },
      resources: { cpuRequest: '100m', memRequest: '256Mi', cpuUsage: null, memUsage: null },
      ports: [
        { name: 'xmpp-c2s', port: 5222, protocol: 'TCP' },
        { name: 'xmpp-s2s', port: 5269, protocol: 'TCP' },
        { name: 'bosh', port: 5280, protocol: 'TCP' },
      ],
      metadata: {},
    },
    {
      id: 'jicofo',
      name: 'Jicofo (Focus)',
      status: jitsiProbe.ok ? 'healthy' : jitsiDomain ? 'down' : 'standby',
      replicas: { running: jitsiProbe.ok ? 1 : 0, desired: 1, max: 1 },
      resources: { cpuRequest: '100m', memRequest: '256Mi', cpuUsage: null, memUsage: null },
      ports: [{ name: 'http', port: 8888, protocol: 'TCP' }],
      metadata: {},
    },
    {
      id: 'jvb',
      name: 'Video Bridge (JVB)',
      status: jvbStatus,
      replicas: { running: jvbRunning, desired: jvbDesired, max: maxJvb },
      resources: { cpuRequest: '1', memRequest: '2Gi', cpuUsage: null, memUsage: null },
      ports: [
        { name: 'media', port: 10000, protocol: 'UDP' },
        { name: 'colibri', port: 8080, protocol: 'TCP' },
      ],
      metadata: {
        stressLevel: jvbStats.stressLevel,
        participants: jvbStats.participants,
        conferences: jvbStats.conferences,
        videochannels: jvbStats.videochannels,
      },
    },
    {
      id: 'jibri',
      name: 'Jibri (Recording)',
      status: jibriInfo.healthy ? 'healthy' : storageType !== 'not-configured' ? 'down' : 'standby',
      replicas: { running: jibriInfo.healthy ? 1 : 0, desired: storageType !== 'not-configured' ? 1 : 0, max: 2 },
      resources: { cpuRequest: '2', memRequest: '4Gi', cpuUsage: null, memUsage: null },
      ports: [{ name: 'api', port: 2222, protocol: 'TCP' }],
      metadata: { busy: jibriInfo.busy, busyStatus: jibriInfo.busyStatus },
    },
    {
      id: 'smtp',
      name: 'SMTP (Email)',
      status: process.env.SMTP_HOST ? 'healthy' : 'standby',
      replicas: { running: process.env.SMTP_HOST ? 1 : 0, desired: 1, max: 1 },
      resources: { cpuRequest: '—', memRequest: '—', cpuUsage: null, memUsage: null },
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

  const nodePools: NodePoolInfo[] = [];
  if (mode === 'full') {
    nodePools.push({
      name: 'system',
      nodeCount: 1,
      minNodes: 1,
      maxNodes: 3,
      status: 'active',
      instanceType: process.env.SYSTEM_NODE_TYPE || 'Standard_D4s_v3',
    });
    nodePools.push({
      name: 'jvb',
      nodeCount: jvbRunning > 0 ? 1 : 0,
      minNodes: 0,
      maxNodes: parseInt(process.env.JVB_MAX_NODES || '4', 10),
      status: jvbDesired === 0 ? 'scaled-to-zero' : jvbRunning < jvbDesired ? 'scaling' : 'active',
      instanceType: process.env.JVB_NODE_TYPE || 'Standard_F4s_v2',
    });
  } else {
    nodePools.push({
      name: 'default',
      nodeCount: 1,
      minNodes: 1,
      maxNodes: 1,
      status: 'active',
      instanceType: mode === 'simple' ? 'docker-compose' : 'Standard_D4s_v3',
    });
  }

  const bitRateDownMbps = jvbStats.bitRateDown !== null ? jvbStats.bitRateDown / 1024 : null;
  const bitRateUpMbps = jvbStats.bitRateUp !== null ? jvbStats.bitRateUp / 1024 : null;

  const data: InfraMapData = {
    cluster: {
      mode,
      version: process.env.npm_package_version || process.env.APP_VERSION || '0.0.0',
      environment: process.env.NODE_ENV || 'development',
      namespace: process.env.POD_NAMESPACE || 'default',
    },
    endpoints,
    services,
    nodePools,
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
    lastUpdated: new Date().toISOString(),
  };

  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
});

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
