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
      dataRetentionDays: 7,
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
        liveRoom: `${baseUrl}/${locale}/eventi/${event.slug}/live?token=${event.moderatorToken}`,
        shareLink: `${baseUrl}/${locale}/eventi/${event.slug}/live`,
      },
    },
    { status: 201 },
  );
});
