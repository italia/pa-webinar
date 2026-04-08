import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

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
    totalRegistrationsToday: number;
    jvbDesiredReplicas: number;
    jvbRunningReplicas: number;
    jvbStatus: 'ready' | 'scaling' | 'standby';
    jvbStressLevel: number | null;
    jvbParticipants: number | null;
  };
  upcomingEvents: {
    title: string;
    startsAt: string;
    status: string;
    maxParticipants: number;
    videoEnabled: boolean;
  }[];
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

async function checkJitsiWeb(): Promise<ComponentStatus> {
  const jitsiDomain = getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN');
  if (!jitsiDomain) {
    return { name: 'jitsi', status: 'unknown', details: 'Not configured' };
  }

  const start = Date.now();
  try {
    const protocol = jitsiDomain.includes('localhost') ? 'http' : 'https';
    const res = await fetch(`${protocol}://${jitsiDomain}/external_api.js`, {
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - start;
    if (res.ok) {
      return {
        name: 'jitsi',
        status: responseTime > 3000 ? 'degraded' : 'operational',
        responseTime,
      };
    }
    return { name: 'jitsi', status: 'degraded', responseTime, details: `HTTP ${res.status}` };
  } catch {
    return { name: 'jitsi', status: 'outage', responseTime: Date.now() - start };
  }
}

async function checkSmtp(): Promise<ComponentStatus> {
  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    return { name: 'smtp', status: 'unknown', details: 'Not configured' };
  }
  return { name: 'smtp', status: 'operational', details: 'Configured' };
}

/** How many JVB instances a single event needs. */
function jvbsForEvent(maxParticipants: number, videoEnabled: boolean): number {
  const maxReplicas = parseInt(process.env.JVB_MAX_REPLICAS || '6', 10);
  if (videoEnabled) {
    if (maxParticipants <= 150) return 1;
    if (maxParticipants <= 350) return 2;
    return Math.min(Math.ceil(maxParticipants / 150), maxReplicas);
  }
  if (maxParticipants <= 500) return 1;
  return Math.min(Math.ceil(maxParticipants / 500), maxReplicas);
}

async function getJvbStatus(): Promise<{
  component: ComponentStatus;
  desired: number;
  running: number;
  jvbStatus: 'ready' | 'scaling' | 'standby';
  stressLevel: number | null;
  participants: number | null;
}> {
  try {
    const now = new Date();
    const preScaleMinutes = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
    const maxReplicas = parseInt(process.env.JVB_MAX_REPLICAS || '6', 10);
    const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);

    const events = await prisma.event.findMany({
      where: {
        OR: [
          { status: 'LIVE' },
          {
            status: 'PUBLISHED',
            startsAt: { lte: preScaleWindow },
            endsAt: { gte: now },
          },
        ],
      },
      select: {
        maxParticipants: true,
        participantsCanStartVideo: true,
      },
    });

    let desired = 0;
    for (const event of events) {
      desired += jvbsForEvent(event.maxParticipants, event.participantsCanStartVideo);
    }
    desired = Math.min(desired, maxReplicas);
    if (events.length > 0 && desired === 0) desired = 1;

    // Check actual JVB pod status via Kubernetes API (if running in-cluster)
    let running = 0;
    let stressLevel: number | null = null;
    let participants: number | null = null;

    if (process.env.KUBERNETES_SERVICE_HOST) {
      try {
        const token = await readFileIfExists('/var/run/secrets/kubernetes.io/serviceaccount/token');
        const namespace = await readFileIfExists('/var/run/secrets/kubernetes.io/serviceaccount/namespace');
        if (token && namespace) {
          const apiBase = `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT}`;
          const res = await fetch(
            `${apiBase}/apis/apps/v1/namespaces/${namespace}/deployments?labelSelector=app.kubernetes.io/component=jvb`,
            {
              headers: { Authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(3000),
              // @ts-expect-error -- Node fetch option
              rejectUnauthorized: false,
            },
          );
          if (res.ok) {
            const data = await res.json() as { items: { status?: { readyReplicas?: number } }[] };
            for (const item of data.items ?? []) {
              running += item.status?.readyReplicas ?? 0;
            }
          }
        }
      } catch {
        // Not critical — fall through to estimation
      }
    }

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
      : jvbStatus === 'scaling'
        ? `Scaling: ${running}/${desired} replicas ready`
        : `${running}/${maxReplicas} replicas ready`;

    return {
      component: {
        name: 'jvb',
        status: desired === 0 ? 'standby' : (jvbStatus === 'ready' ? 'operational' : 'degraded'),
        details: statusText,
      },
      desired,
      running,
      jvbStatus,
      stressLevel,
      participants,
    };
  } catch {
    return {
      component: { name: 'jvb', status: 'unknown' },
      desired: 0,
      running: 0,
      jvbStatus: 'standby',
      stressLevel: null,
      participants: null,
    };
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    return (await readFile(path, 'utf-8')).trim();
  } catch {
    return null;
  }
}

export const GET = withErrorHandling(async () => {
  const [db, jitsi, smtp, jvb] = await Promise.all([
    checkDatabase(),
    checkJitsiWeb(),
    checkSmtp(),
    getJvbStatus(),
  ]);

  const app: ComponentStatus = { name: 'app', status: 'operational' };

  const jibri: ComponentStatus = {
    name: 'jibri',
    status: process.env.JIBRI_ENABLED === 'true' ? 'operational' : 'standby',
    details: process.env.JIBRI_ENABLED === 'true' ? undefined : 'Not enabled',
  };

  const components = [app, db, jitsi, jvb.component, jibri, smtp];

  const hasOutage = components.some((c) => c.status === 'outage');
  const hasDegraded = components.some((c) => c.status === 'degraded');
  const overall: SystemStatus['overall'] = hasOutage
    ? 'outage'
    : hasDegraded
      ? 'degraded'
      : 'operational';

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [activeEvents, totalRegsToday, upcomingEvents] = await Promise.all([
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.registration.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.event.findMany({
      where: {
        status: { in: ['PUBLISHED', 'LIVE'] },
        endsAt: { gte: now },
      },
      orderBy: { startsAt: 'asc' },
      take: 5,
      select: {
        titleIt: true,
        startsAt: true,
        status: true,
        maxParticipants: true,
        participantsCanStartVideo: true,
      },
    }),
  ]);

  const status: SystemStatus = {
    overall,
    components,
    metrics: {
      activeEvents,
      totalRegistrationsToday: totalRegsToday,
      jvbDesiredReplicas: jvb.desired,
      jvbRunningReplicas: jvb.running,
      jvbStatus: jvb.jvbStatus,
      jvbStressLevel: jvb.stressLevel,
      jvbParticipants: jvb.participants,
    },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: e.titleIt,
      startsAt: e.startsAt.toISOString(),
      status: e.status,
      maxParticipants: e.maxParticipants,
      videoEnabled: e.participantsCanStartVideo,
    })),
    lastChecked: now.toISOString(),
  };

  return Response.json(status, {
    headers: { 'Cache-Control': 'no-store' },
  });
});
