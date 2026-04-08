/**
 * Internal API for JVB auto-scaling.
 *
 * Returns the desired number of JVB replicas as JSON.
 * Called by the jvb-scaler CronJob every 2 minutes (cluster-internal only).
 *
 * Two-phase scaling:
 *
 *   Phase 1 — Predictive (pre-event):
 *     Based on maxParticipants and video mode of upcoming/active events.
 *     Webinar (video off): 1 JVB handles ~500 passive viewers.
 *     Interactive (video on): 1 JVB handles ~150 participants with webcams.
 *
 *   Phase 2 — Reactive (during event):
 *     If the caller provides JVB stress_level from colibri stats,
 *     we adjust upward when stress > 0.6.
 */

import { withErrorHandling } from '@/lib/api-handler';
import { assertCronApiKey } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

const PRE_SCALE_MINUTES = parseInt(process.env.JVB_PRE_SCALE_MINUTES || '30', 10);
const MAX_REPLICAS = parseInt(process.env.JVB_MAX_REPLICAS || '6', 10);

/** How many JVB instances a single event needs, based on its configuration. */
function jvbsForEvent(maxParticipants: number, videoEnabled: boolean): number {
  if (videoEnabled) {
    // Interactive: ~150 participants with webcams per JVB
    if (maxParticipants <= 150) return 1;
    if (maxParticipants <= 350) return 2;
    return Math.min(Math.ceil(maxParticipants / 150), MAX_REPLICAS);
  }
  // Webinar: ~500 passive viewers per JVB
  if (maxParticipants <= 500) return 1;
  return Math.min(Math.ceil(maxParticipants / 500), MAX_REPLICAS);
}

export const GET = withErrorHandling(async (request) => {
  assertCronApiKey(request);

  const now = new Date();
  const preScaleWindow = new Date(now.getTime() + PRE_SCALE_MINUTES * 60 * 1000);

  // Fetch active or upcoming events with their capacity & video settings
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
      id: true,
      maxParticipants: true,
      participantsCanStartVideo: true,
      status: true,
    },
  });

  // Phase 1 — Predictive: sum JVBs needed across concurrent events
  let predictiveDesired = 0;
  const breakdown: { eventId: string; maxParticipants: number; videoEnabled: boolean; jvbs: number }[] = [];

  for (const event of events) {
    const jvbs = jvbsForEvent(event.maxParticipants, event.participantsCanStartVideo);
    predictiveDesired += jvbs;
    breakdown.push({
      eventId: event.id,
      maxParticipants: event.maxParticipants,
      videoEnabled: event.participantsCanStartVideo,
      jvbs,
    });
  }

  // Phase 2 — Reactive: if caller reports JVB stress, adjust upward
  const stressParam = new URL(request.url).searchParams.get('stress_level');
  const stressLevel = stressParam ? parseFloat(stressParam) : null;
  let reactiveAdjustment = 0;

  if (stressLevel !== null && !isNaN(stressLevel)) {
    if (stressLevel > 0.7) {
      // High stress — add 2 extra JVBs
      reactiveAdjustment = 2;
    } else if (stressLevel > 0.5) {
      // Moderate stress — add 1 extra JVB
      reactiveAdjustment = 1;
    }
  }

  const desired = Math.min(
    Math.max(predictiveDesired + reactiveAdjustment, events.length > 0 ? 1 : 0),
    MAX_REPLICAS,
  );

  return Response.json({
    desired,
    predictiveDesired,
    reactiveAdjustment,
    stressLevel,
    activeEvents: events.length,
    breakdown,
    preScaleMinutes: PRE_SCALE_MINUTES,
    maxReplicas: MAX_REPLICAS,
    checkedAt: now.toISOString(),
  });
});
