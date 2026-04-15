import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { jvbsForEvent, jvbMaxReplicasFromEnv, JVB_BILLABLE_STATUSES } from '@/lib/jvb-sizing';
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
    idleEvents: number;
    provisioningEvents: number;
    totalRegistrationsToday: number;
    jvbDesiredReplicas: number;
    jvbRunningReplicas: number;
    jvbStatus: 'ready' | 'scaling' | 'standby';
    jvbStressLevel: number | null;
    jvbParticipants: number | null;
    // Octo (multi-bridge cascading). Populated from /colibri/stats of
    // whichever JVB pod the service LB routes us to — aggregate across
    // bridges requires per-pod queries which we don't do here.
    jvbOctoEnabled: boolean;
    jvbOctoConferences: number | null;
    jvbOctoEndpoints: number | null;
    jvbOctoSendBitrateBps: number | null;
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

interface JvbStatusResult {
  component: ComponentStatus;
  desired: number;
  running: number;
  jvbStatus: 'ready' | 'scaling' | 'standby';
  stressLevel: number | null;
  participants: number | null;
  octoEnabled: boolean;
  octoConferences: number | null;
  octoEndpoints: number | null;
  octoSendBitrateBps: number | null;
}

async function getJvbStatus(): Promise<JvbStatusResult> {
  try {
    const now = new Date();
    const preScaleMinutes = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '10', 10);
    const maxReplicas = jvbMaxReplicasFromEnv();
    const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);

    // LIVE + PROVISIONING: already billing JVB capacity.
    // PUBLISHED within the pre-scale window: scaler will promote them to
    // PROVISIONING shortly, so we count them too to avoid a visible dip.
    // IDLE is deliberately excluded (that's the whole point of scale-to-zero).
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { status: { in: [...JVB_BILLABLE_STATUSES] } },
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
      desired += jvbsForEvent(event.maxParticipants, event.participantsCanStartVideo, maxReplicas);
    }
    desired = Math.min(desired, maxReplicas);
    if (events.length > 0 && desired === 0) desired = 1;

    let running = 0;
    let stressLevel: number | null = null;
    let participants: number | null = null;
    let octoEnabled = false;
    let octoConferences: number | null = null;
    let octoEndpoints: number | null = null;
    let octoSendBitrateBps: number | null = null;

    const jvbHealthUrl = process.env.JVB_HEALTH_URL;
    if (jvbHealthUrl) {
      try {
        const res = await fetch(`${jvbHealthUrl}/colibri/stats`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const stats = await res.json() as Record<string, unknown>;
          if (stats.healthy !== false) {
            running = 1;
            stressLevel = typeof stats.stress_level === 'number' ? stats.stress_level : null;
            participants = typeof stats.participants === 'number' ? stats.participants : null;
            // Octo is considered "enabled" for this reporting purpose when
            // the bridge has relay traffic OR is serving an octo conference.
            // /colibri/stats always exposes these fields; a zero value with
            // octo disabled is indistinguishable from octo-enabled-but-idle,
            // so we key on the presence of non-zero relay fields at report
            // time instead of a separate config probe.
            octoConferences = typeof stats.octo_conferences === 'number' ? stats.octo_conferences : null;
            octoEndpoints = typeof stats.octo_endpoints === 'number' ? stats.octo_endpoints : null;
            octoSendBitrateBps = typeof stats.octo_send_bitrate === 'number' ? stats.octo_send_bitrate : null;
            octoEnabled = (octoConferences ?? 0) > 0 || (octoSendBitrateBps ?? 0) > 0;
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
      octoEnabled,
      octoConferences,
      octoEndpoints,
      octoSendBitrateBps,
    };
  } catch {
    return {
      component: { name: 'jvb', status: 'unknown' },
      desired: 0,
      running: 0,
      jvbStatus: 'standby',
      stressLevel: null,
      participants: null,
      octoEnabled: false,
      octoConferences: null,
      octoEndpoints: null,
      octoSendBitrateBps: null,
    };
  }
}

async function getJibriStatus(recordingNeeded: boolean): Promise<{
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
  // Check whether any currently-billable event wants recording. Drives
  // Jibri's "expected to be up" signal.
  const recordingNeeded = (await prisma.event.count({
    where: {
      status: { in: [...JVB_BILLABLE_STATUSES] },
      recordingEnabled: true,
    },
  })) > 0;

  const [db, jitsi, smtp, jvb, jibriResult] = await Promise.all([
    checkDatabase(),
    checkJitsiWeb(),
    checkSmtp(),
    getJvbStatus(),
    getJibriStatus(recordingNeeded),
  ]);

  const app: ComponentStatus = { name: 'app', status: 'operational' };
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

  const [activeEvents, idleEvents, provisioningEvents, totalRegsToday, upcomingEvents] = await Promise.all([
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.event.count({ where: { status: 'IDLE', endsAt: { gt: now } } }),
    prisma.event.count({ where: { status: 'PROVISIONING' } }),
    prisma.registration.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.event.findMany({
      where: {
        // Include PROVISIONING and IDLE so the public page reflects the
        // actual lifecycle state of upcoming/recently-active events.
        status: { in: ['PUBLISHED', 'PROVISIONING', 'LIVE', 'IDLE'] },
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
      idleEvents,
      provisioningEvents,
      totalRegistrationsToday: totalRegsToday,
      jvbDesiredReplicas: jvb.desired,
      jvbRunningReplicas: jvb.running,
      jvbStatus: jvb.jvbStatus,
      jvbStressLevel: jvb.stressLevel,
      jvbParticipants: jvb.participants,
      jvbOctoEnabled: jvb.octoEnabled,
      jvbOctoConferences: jvb.octoConferences,
      jvbOctoEndpoints: jvb.octoEndpoints,
      jvbOctoSendBitrateBps: jvb.octoSendBitrateBps,
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
