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
    jvbStatus: 'ready' | 'scaling' | 'standby';
  };
  upcomingEvents: {
    title: string;
    startsAt: string;
    status: string;
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
    const protocol = jitsiDomain.includes('localhost') ? 'https' : 'https';
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

async function getJvbStatus(): Promise<{
  component: ComponentStatus;
  desired: number;
  jvbStatus: 'ready' | 'scaling' | 'standby';
}> {
  try {
    const now = new Date();
    const preScaleMinutes = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
    const maxReplicas = parseInt(process.env.JVB_MAX_REPLICAS || '4', 10);
    const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);

    const activeOrUpcoming = await prisma.event.count({
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
    });

    let desired = 0;
    if (activeOrUpcoming > 0) {
      desired = Math.min(Math.max(1, Math.ceil(activeOrUpcoming / 2)), maxReplicas);
    }

    let jvbStatus: 'ready' | 'scaling' | 'standby' = 'standby';
    if (desired > 0) {
      jvbStatus = 'ready';
    }

    return {
      component: {
        name: 'jvb',
        status: desired === 0 ? 'standby' : 'operational',
        details: desired === 0
          ? 'Scale-to-zero active'
          : `${desired}/${maxReplicas} replicas desired`,
      },
      desired,
      jvbStatus,
    };
  } catch {
    return {
      component: { name: 'jvb', status: 'unknown' },
      desired: 0,
      jvbStatus: 'standby',
    };
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
      take: 3,
      select: { titleIt: true, startsAt: true, status: true },
    }),
  ]);

  const status: SystemStatus = {
    overall,
    components,
    metrics: {
      activeEvents,
      totalRegistrationsToday: totalRegsToday,
      jvbDesiredReplicas: jvb.desired,
      jvbStatus: jvb.jvbStatus,
    },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: e.titleIt,
      startsAt: e.startsAt.toISOString(),
      status: e.status,
    })),
    lastChecked: now.toISOString(),
  };

  return Response.json(status, {
    headers: { 'Cache-Control': 'no-store' },
  });
});
