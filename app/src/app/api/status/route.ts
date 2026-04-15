import { withErrorHandling } from '@/lib/api-handler';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { jvbsForEvent, jvbMaxReplicasFromEnv, JVB_BILLABLE_STATUSES } from '@/lib/jvb-sizing';
import { getSettings } from '@/lib/settings';
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
    jvbStale: boolean;
    // Octo (multi-bridge cascading). Populated from /colibri/stats of
    // whichever JVB pod the service LB routes us to — aggregate across
    // bridges requires per-pod queries which we don't do here.
    jvbOctoEnabled: boolean;
    jvbOctoConferences: number | null;
    jvbOctoEndpoints: number | null;
    jvbOctoSendBitrateBps: number | null;
    jibriStatus: 'ready' | 'scaling' | 'standby' | 'unavailable';
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
  /** True when ≥1 billable event has been waiting for JVB longer than the configured timeout. */
  stale: boolean;
}

async function getJvbStatus(
  preScaleMinutes: number,
  provisioningTimeoutMinutes: number,
): Promise<JvbStatusResult> {
  try {
    const now = new Date();
    const maxReplicas = jvbMaxReplicasFromEnv();
    const preScaleWindow = new Date(now.getTime() + preScaleMinutes * 60 * 1000);
    const staleCutoff = new Date(now.getTime() - provisioningTimeoutMinutes * 60 * 1000);

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
        id: true,
        slug: true,
        status: true,
        startsAt: true,
        provisioningStartedAt: true,
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
      desired,
      running,
      jvbStatus,
      stressLevel,
      participants,
      octoEnabled,
      octoConferences,
      octoEndpoints,
      octoSendBitrateBps,
      stale: isStale,
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
      stale: false,
    };
  }
}

async function getJibriStatus(recordingNeeded: boolean, recordingStale: boolean): Promise<{
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

  // If the event requesting recording has been waiting past the
  // provisioning timeout, flag Jibri as degraded with a stale-specific
  // message instead of the generic "scaling up".
  const details = running > 0
    ? `${running} instance(s) ready${busyStatus ? ` (${busyStatus})` : ''}`
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

export const GET = withErrorHandling(async () => {
  const settings = await getSettings();
  const preScaleMinutes = settings.jvbPreScaleMinutes ?? 10;
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
  const recordingNeeded = recordingEvents.length > 0;
  const recordingStale = recordingEvents.some((e) => {
    const since = e.provisioningStartedAt ?? e.startsAt;
    return since <= staleCutoff;
  });

  const [db, jitsi, smtp, jvb, jibriResult, orphanRecordingsPendingCount] = await Promise.all([
    checkDatabase(),
    checkJitsiWeb(),
    checkSmtp(),
    getJvbStatus(preScaleMinutes, provisioningTimeoutMinutes),
    getJibriStatus(recordingNeeded, recordingStale),
    prisma.orphanRecording.count({ where: { decision: 'pending' } }).catch(() => 0),
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
      jvbStale: jvb.stale,
      jvbOctoEnabled: jvb.octoEnabled,
      jvbOctoConferences: jvb.octoConferences,
      jvbOctoEndpoints: jvb.octoEndpoints,
      jvbOctoSendBitrateBps: jvb.octoSendBitrateBps,
      jibriStatus: jibriResult.jibriStatus,
      jibriRunningReplicas: jibriResult.running,
      jibriStale: recordingStale && jibriResult.running === 0,
      orphanRecordingsPending: orphanRecordingsPendingCount,
    },
    upcomingEvents: upcomingEvents.map((e) => ({
      title: getLocalized(e.title as LocalizedField, 'it'),
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
