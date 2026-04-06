import { withErrorHandling, parseJsonBody } from '@/lib/api-handler';
import {
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  AppError,
} from '@/lib/errors';
import { prisma } from '@/lib/db';
import { updateEventSchema } from '@/lib/validation/schemas';
import { resolveLocale, localiseEvent } from '@/lib/utils/locale';
import {
  extractModeratorToken,
  verifyModeratorToken,
  constantTimeEqual,
} from '@/lib/auth/moderator';
import { sendDateChangeNotifications } from '@/lib/email/notification';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── GET /api/events/[slug|id] — Event detail ────────────────

export const GET = withErrorHandling(async (request, context) => {
  const { param } = await context.params;
  const locale = resolveLocale(request);
  const token = extractModeratorToken(request);
  const isUuid = UUID_RE.test(param);

  const event = await prisma.event.findUnique({
    where: isUuid ? { id: param } : { slug: param },
    include: {
      _count: { select: { registrations: true } },
      registrations: token
        ? {
            select: {
              id: true,
              displayName: true,
              joinedAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          }
        : false,
    },
  });

  if (!event) throw new NotFoundError('Event');

  const { title, description } = localiseEvent(event, locale);

  // Moderator mode: verify token and return full data
  if (token && constantTimeEqual(event.moderatorToken, token)) {
    return Response.json({
      id: event.id,
      slug: event.slug,
      title,
      titleIt: event.titleIt,
      titleEn: event.titleEn,
      description,
      descriptionIt: event.descriptionIt,
      descriptionEn: event.descriptionEn,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      timezone: event.timezone,
      maxParticipants: event.maxParticipants,
      registrationCount: event._count.registrations,
      qaEnabled: event.qaEnabled,
      chatEnabled: event.chatEnabled,
      recordingEnabled: event.recordingEnabled,
      participantsCanUnmute: event.participantsCanUnmute,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanShareScreen: event.participantsCanShareScreen,
      status: event.status,
      recordingUrl: event.recordingUrl,
      moderatorToken: event.moderatorToken,
      moderatorName: event.moderatorName,
      moderatorEmail: event.moderatorEmail,
      jitsiRoomName: event.jitsiRoomName,
      dataRetentionDays: event.dataRetentionDays,
      privacyPolicyUrl: event.privacyPolicyUrl,
      speakersIt: event.speakersIt,
      speakersEn: event.speakersEn,
      organizerName: event.organizerName,
      imageUrl: event.imageUrl,
      waitingRoomAudioUrl: event.waitingRoomAudioUrl,
      createdAt: event.createdAt.toISOString(),
      registrations: event.registrations,
    });
  }

  // Public mode — hide DRAFT and ARCHIVED events
  if (event.status === 'DRAFT' || event.status === 'ARCHIVED') {
    throw new NotFoundError('Event');
  }

  return Response.json({
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
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
    status: event.status,
    recordingUrl: event.recordingUrl,
  }, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    },
  });
});

// ── PUT /api/events/[id] — Update event (moderator only) ────

export const PUT = withErrorHandling(async (request, context) => {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await verifyModeratorToken(eventId, token);
  if (!event) throw new ForbiddenError('Invalid moderator token or event not found');

  const body = await parseJsonBody(request);
  const parsed = updateEventSchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Validation failed', parsed.error.issues.map((i) => ({ path: i.path, message: i.message })));
  }

  const data = parsed.data;

  const dateChanged =
    (data.startsAt !== undefined && new Date(data.startsAt).getTime() !== event.startsAt.getTime()) ||
    (data.endsAt !== undefined && new Date(data.endsAt).getTime() !== event.endsAt.getTime());

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(data.titleIt !== undefined && { titleIt: data.titleIt }),
      ...(data.titleEn !== undefined && { titleEn: data.titleEn }),
      ...(data.descriptionIt !== undefined && {
        descriptionIt: data.descriptionIt,
      }),
      ...(data.descriptionEn !== undefined && {
        descriptionEn: data.descriptionEn,
      }),
      ...(data.startsAt !== undefined && {
        startsAt: new Date(data.startsAt),
      }),
      ...(data.endsAt !== undefined && { endsAt: new Date(data.endsAt) }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.maxParticipants !== undefined && {
        maxParticipants: data.maxParticipants,
      }),
      ...(data.qaEnabled !== undefined && { qaEnabled: data.qaEnabled }),
      ...(data.chatEnabled !== undefined && {
        chatEnabled: data.chatEnabled,
      }),
      ...(data.recordingEnabled !== undefined && {
        recordingEnabled: data.recordingEnabled,
      }),
      ...(data.participantsCanUnmute !== undefined && {
        participantsCanUnmute: data.participantsCanUnmute,
      }),
      ...(data.participantsCanStartVideo !== undefined && {
        participantsCanStartVideo: data.participantsCanStartVideo,
      }),
      ...(data.participantsCanShareScreen !== undefined && {
        participantsCanShareScreen: data.participantsCanShareScreen,
      }),
      ...(data.dataRetentionDays !== undefined && {
        dataRetentionDays: data.dataRetentionDays,
      }),
      ...(data.privacyPolicyUrl !== undefined && {
        privacyPolicyUrl: data.privacyPolicyUrl,
      }),
      ...(data.moderatorName !== undefined && {
        moderatorName: data.moderatorName,
      }),
      ...(data.moderatorEmail !== undefined && {
        moderatorEmail: data.moderatorEmail,
      }),
      ...(data.speakersIt !== undefined && { speakersIt: data.speakersIt }),
      ...(data.speakersEn !== undefined && { speakersEn: data.speakersEn }),
      ...(data.organizerName !== undefined && { organizerName: data.organizerName }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      ...(data.waitingRoomAudioUrl !== undefined && { waitingRoomAudioUrl: data.waitingRoomAudioUrl }),
      ...(data.status !== undefined && { status: data.status }),
    },
  });

  if (dateChanged && event.status === 'PUBLISHED') {
    const locale = resolveLocale(request) as 'it' | 'en';
    sendDateChangeNotifications({ eventId, locale });
  }

  return Response.json({ ...updated, dateChanged });
});

// ── DELETE /api/events/[id] — Delete event (moderator only) ──

export const DELETE = withErrorHandling(async (request, context) => {
  const { param: eventId } = await context.params;

  if (!UUID_RE.test(eventId)) {
    throw new AppError('Event ID must be a UUID', 400, 'BAD_REQUEST');
  }

  const token = extractModeratorToken(request);
  if (!token) throw new UnauthorizedError('Moderator token required');

  const event = await verifyModeratorToken(eventId, token);
  if (!event) throw new ForbiddenError('Invalid moderator token or event not found');

  await prisma.event.delete({ where: { id: eventId } });

  return Response.json({ deleted: true, id: eventId });
});
