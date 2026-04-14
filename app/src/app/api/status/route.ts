import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

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
    jibriStatus: 'ready' | 'scaling' | 'standby' | 'unavailable';
    jibriRunningReplicas: number;
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

    let running = 0;
    let stressLevel: number | null = null;
    let participants: number | null = null;

    const jvbHealthUrl = process.env.JVB_HEALTH_URL;
    if (jvbHealthUrl) {
      try {
        const res = await fetch(`${jvbHealthUrl}/colibri/stats`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const stats = await res.json() as {
            healthy?: boolean;
            stress_level?: number;
            participants?: number;
          };
          if (stats.healthy !== false) {
            running = 1;
            stressLevel = stats.stress_level ?? null;
            participants = stats.participants ?? null;
          }
        }
      } catch {
        // JVB not reachable — running stays 0
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

async function getJibriStatus(): Promise<{
  component: ComponentStatus;
  running: number;
  jibriStatus: 'ready' | 'scaling' | 'standby' | 'unavailable';
}> {
  const storageType = process.env.RECORDING_STORAGE_TYPE;
  const storageConfigured = !!storageType && storageType !== 'local';

  if (!storageConfigured) {
    return {
      component: { name: 'jibri', status: 'standby', details: 'Not configured' },
      running: 0,
      jibriStatus: 'unavailable',
    };
  }

  let running = 0;
  let busyStatus: string | null = null;

  const jibriHealthUrl = process.env.JIBRI_HEALTH_URL;
  if (jibriHealthUrl) {
    try {
      const res = await fetch(`${jibriHealthUrl}/jibri/api/v1.0/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as {
          status?: { busyStatus?: string; health?: { healthStatus?: string } };
        };
        if (data.status?.health?.healthStatus === 'HEALTHY') {
          running = 1;
          busyStatus = data.status.busyStatus ?? null;
        }
      }
    } catch {
      // Jibri not reachable — running stays 0
    }
  } else if (!process.env.KUBERNETES_SERVICE_HOST) {
    return {
      component: { name: 'jibri', status: 'operational' },
      running: 1,
      jibriStatus: 'ready',
    };
  }

  const jibriStatus: 'ready' | 'scaling' | 'standby' | 'unavailable' =
    running > 0 ? 'ready' : 'scaling';

  return {
    component: {
      name: 'jibri',
      status: running > 0 ? 'operational' : 'degraded',
      details: running > 0
        ? `${running} instance(s) ready${busyStatus ? ` (${busyStatus})` : ''}`
        : 'No instances running — scaling up',
    },
    running,
    jibriStatus,
  };
}

export const GET = withErrorHandling(async () => {
  const [db, jitsi, smtp, jvb] = await Promise.all([
    checkDatabase(),
    checkJitsiWeb(),
    checkSmtp(),
    getJvbStatus(),
  ]);

  const app: ComponentStatus = { name: 'app', status: 'operational' };

  const jibriResult = await getJibriStatus();
  const jibri = jibriResult.component;

  const prosody: ComponentStatus = {
    name: 'prosody',
    status: jitsi.status === 'operational' ? 'operational' : jitsi.status === 'outage' ? 'outage' : jitsi.status,
    details: jitsi.status === 'operational' ? 'Healthy' : 'Depends on Jitsi Web',
  };
  const jicofo: ComponentStatus = {
    name: 'jicofo',
    status: jitsi.status === 'operational' ? 'operational' : jitsi.status === 'outage' ? 'outage' : jitsi.status,
    details: jitsi.status === 'operational' ? 'Healthy' : 'Depends on Jitsi Web',
  };

  const components = [app, db, jitsi, prosody, jicofo, jvb.component, jibri, smtp];

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
        title: true,
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
      jibriStatus: jibriResult.jibriStatus,
      jibriRunningReplicas: jibriResult.running,
    },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: getLocalized(e.title as LocalizedField, 'it'),
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
