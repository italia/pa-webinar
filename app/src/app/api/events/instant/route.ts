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
  const maxDuration = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const slug = await generateUniqueSlug(data.title);
  const jitsiRoomName = `call-${randomUUID()}`;
  const moderatorToken = randomUUID();

  const capacityEstimate = calculateEstimates({
    maxParticipants: 50,
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
      maxParticipants: 50,
      qaEnabled: false,
      chatEnabled: true,
      recordingEnabled: true,
      participantsCanUnmute: true,
      participantsCanStartVideo: true,
      participantsCanShareScreen: true,
      moderatorName: data.moderatorName,
      status: 'LIVE',
      // Seed lastActiveAt so the LIVE→IDLE scaler's grace-cutoff OR-clause
      // can match this event. Without it, lastActiveAt stays null and the
      // call lingers LIVE until the 24h endsAt upper bound kicks in.
      lastActiveAt: now,
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
