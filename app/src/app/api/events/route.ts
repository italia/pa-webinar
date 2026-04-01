import { randomUUID } from 'crypto';

import type { EventStatus } from '@prisma/client';
import { cookies } from 'next/headers';

import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import { UnauthorizedError, RateLimitError, ValidationError } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { createEventSchema } from '@/lib/validation/schemas';
import { rateLimit, getClientIp } from '@/lib/rate-limit';
import { generateUniqueSlug } from '@/lib/utils/slug';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export const dynamic = 'force-dynamic';

const PUBLIC_STATUSES: EventStatus[] = ['PUBLISHED', 'LIVE', 'ENDED'];

// ── POST /api/events — Create event ──────────────────────────

export const POST = withErrorHandling(async (request) => {
  const cookieStore = await cookies();
  const isAdmin = await isAdminAuthenticated(cookieStore);
  if (!isAdmin) throw new UnauthorizedError();

  const ip = getClientIp(request);
  const rl = rateLimit(`create-event:${ip}`, {
    limit: 5,
    windowMs: 60_000,
  });

  if (!rl.allowed) {
    throw new RateLimitError((rl.resetAt - Date.now()) / 1000);
  }

  const body = await parseJsonBody(request);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const data = parsed.data;

  const slug = await generateUniqueSlug(data.titleIt);
  const jitsiRoomName = `evt-${randomUUID()}`;
  const moderatorToken = randomUUID();

  const event = await prisma.event.create({
    data: {
      slug,
      jitsiRoomName,
      moderatorToken,
      titleIt: data.titleIt,
      titleEn: data.titleEn,
      descriptionIt: data.descriptionIt,
      descriptionEn: data.descriptionEn,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      timezone: data.timezone,
      maxParticipants: data.maxParticipants,
      qaEnabled: data.qaEnabled,
      chatEnabled: data.chatEnabled,
      recordingEnabled: data.recordingEnabled,
      participantsCanUnmute: data.participantsCanUnmute,
      participantsCanStartVideo: data.participantsCanStartVideo,
      participantsCanShareScreen: data.participantsCanShareScreen,
      dataRetentionDays: data.dataRetentionDays,
      privacyPolicyUrl: data.privacyPolicyUrl,
      privacyPolicyText: data.privacyPolicyText,
      moderatorName: data.moderatorName,
      moderatorEmail: data.moderatorEmail,
      speakersIt: data.speakersIt,
      speakersEn: data.speakersEn,
      organizerName: data.organizerName,
      imageUrl: data.imageUrl,
      waitingRoomAudioUrl: data.waitingRoomAudioUrl,
      // Default reminders: 1 day and 1 hour before
      reminders: {
        create: [
          { offsetMinutes: 1440, label: '1 giorno prima' },
          { offsetMinutes: 60, label: '1 ora prima' },
        ],
      },
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const locale = resolveLocale(request);

  return Response.json(
    {
      ...event,
      links: {
        publicPage: `${baseUrl}/${locale}/eventi/${event.slug}`,
        moderatorLink: `${baseUrl}/${locale}/admin/eventi/${event.id}?token=${event.moderatorToken}`,
      },
    },
    { status: 201 },
  );
});

// ── GET /api/events — List events ────────────────────────────

export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const statusFilter = url.searchParams.get('status');
  const moderatorToken = url.searchParams.get('moderatorToken');
  const locale = resolveLocale(request);

  // Moderator mode: return all events owned by this token (including DRAFT)
  if (moderatorToken) {
    const events = await prisma.event.findMany({
      where: { moderatorToken },
      include: { _count: { select: { registrations: true } } },
      orderBy: { startsAt: 'asc' },
    });

    const result = events.map((event) => {
      const { title, description } = localiseEvent(event, locale);
      return {
        id: event.id,
        slug: event.slug,
        title,
        titleIt: event.titleIt,
        titleEn: event.titleEn,
        description,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        timezone: event.timezone,
        maxParticipants: event.maxParticipants,
        registrationCount: event._count.registrations,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        recordingEnabled: event.recordingEnabled,
        status: event.status,
        recordingUrl: event.recordingUrl,
        moderatorToken: event.moderatorToken,
      };
    });

    return Response.json(result);
  }

  // Public mode: only PUBLISHED, LIVE, ENDED
  let whereStatus: EventStatus[];
  if (
    statusFilter &&
    PUBLIC_STATUSES.includes(statusFilter as EventStatus)
  ) {
    whereStatus = [statusFilter as EventStatus];
  } else {
    whereStatus = PUBLIC_STATUSES;
  }

  const events = await prisma.event.findMany({
    where: { status: { in: whereStatus } },
    include: { _count: { select: { registrations: true } } },
    orderBy: { startsAt: 'asc' },
  });

  const result = events.map((event) => {
    const { title, description } = localiseEvent(event, locale);
    return {
      id: event.id,
      slug: event.slug,
      title,
      description,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      maxParticipants: event.maxParticipants,
      registrationCount: event._count.registrations,
      qaEnabled: event.qaEnabled,
      recordingEnabled: event.recordingEnabled,
      status: event.status,
      recordingUrl: event.recordingUrl,
    };
  });

  return Response.json(result);
});
