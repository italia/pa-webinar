import { randomUUID } from 'crypto';

import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, RateLimitError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createInstantCallSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { generateUniqueSlug } from '@/lib/utils/slug';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getPublicEnv } from '@/lib/env';
import { resolveLocale } from '@/lib/utils/locale';
import { localizedUrl } from '@/lib/utils/localized-url';
import { calculateEstimates } from '@/lib/estimates';
import { hashJoinPassword } from '@/lib/auth/password';

export const dynamic = 'force-dynamic';

export const POST = withErrorHandling(async (request) => {
  const cookieStore = await cookies();
  const isAdmin = await isAdminAuthenticated(cookieStore);
  if (!isAdmin) throw new UnauthorizedError();

  const ip = getClientIp(request);
  const rl = rateLimit(`create-instant:${ip}`, {
    limit: 10,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = createInstantCallSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(
      'Validation failed',
      parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }

  const data = parsed.data;
  const now = new Date();
  // Instant calls have no meaningful "end time" — they go LIVE and stay LIVE
  // until everyone leaves (handled by the inactivity-grace path; see
  // gracePeriodMinutes=-1 below). The endsAt is a cosmetic upper bound used
  // by listing/analytics queries that filter `endsAt >= now`; 4h is enough
  // headroom for any normal call without making the UI render
  // "ends tomorrow" for a 30-minute meeting.
  const maxDuration = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const slug = await generateUniqueSlug(data.title);
  const jitsiRoomName = `call-${randomUUID()}`;
  const moderatorToken = randomUUID();

  // Default matches the admin UI placeholder. Bigger calls (demos, 100+
  // audiences) must pass `maxParticipants` explicitly so the JVB scaler's
  // next tick sees the real capacity need — instant calls skip the
  // PUBLISHED→PROVISIONING pre-scale window, so the *initial* desired
  // replica count is whatever this value implies and nothing more.
  const maxParticipants = data.maxParticipants ?? 50;

  const capacityEstimate = calculateEstimates({
    maxParticipants,
    startsAt: now.toISOString(),
    endsAt: maxDuration.toISOString(),
    recordingEnabled: true,
    participantsCanUnmute: true,
    participantsCanStartVideo: true,
    participantsCanShareScreen: true,
  });

  const event = await prisma.event.create({
    data: {
      slug,
      jitsiRoomName,
      moderatorToken,
      eventType: 'INSTANT',
      title: data.title,
      description: { it: 'Videocall istantanea' },
      startsAt: now,
      endsAt: maxDuration,
      maxParticipants,
      qaEnabled: false,
      chatEnabled: true,
      // Whiteboard sempre attiva nelle videocall istantanee (il client la
      // forza comunque; qui allineiamo lo stato in DB).
      whiteboardEnabled: true,
      recordingEnabled: true,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
      moderatorName: data.moderatorName,
      status: 'LIVE',
      // Seed lastActiveAt so the LIVE→IDLE scaler's grace-cutoff OR-clause
      // can match this event. Without it, lastActiveAt stays null and the
      // call lingers LIVE until the cosmetic endsAt upper bound kicks in.
      lastActiveAt: now,
      // Instant calls don't auto-close on endsAt — close on inactivity
      // instead (~45min after the last participant leaves, per the
      // scaler's inactiveGraceMinutes default). This decouples the
      // cosmetic "ends at" from the actual lifecycle.
      gracePeriodMinutes: -1,
      // Align with the scheduled-event flow where the PUBLISHED→PROVISIONING
      // transition stamps this field. For instant calls we skip that state
      // but still set the timestamp — the provisioning-timeout UI path and
      // the IDLE-demotion fallback both depend on it being non-null.
      provisioningStartedAt: now,
      dataRetentionDays: 7,
      capacityEstimateJson: {
        ...capacityEstimate,
        computedAt: now.toISOString(),
      },
      joinPasswordHash:
        data.joinPassword && data.joinPassword.length > 0
          ? hashJoinPassword(data.joinPassword)
          : null,
    },
  });

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const locale = resolveLocale(request);

  return Response.json(
    {
      id: event.id,
      slug: event.slug,
      jitsiRoomName: event.jitsiRoomName,
      moderatorToken: event.moderatorToken,
      links: {
        liveRoom: localizedUrl(baseUrl, `/events/${event.slug}/live?token=${event.moderatorToken}`, locale),
        shareLink: localizedUrl(baseUrl, `/events/${event.slug}/live`, locale),
      },
    },
    { status: 201 },
  );
});
