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
import { calculateEstimates } from '@/lib/estimates';
import { hashJoinPassword } from '@/lib/auth/password';

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
      titleAll: event.title,
      description,
      descriptionAll: event.description,
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
      tempRecordingUrl: event.tempRecordingUrl,
      tempRecordingStartedAt: event.tempRecordingStartedAt?.toISOString() ?? null,
      recordingPublished: event.recordingPublished,
      recordingPublishedAt: event.recordingPublishedAt?.toISOString() ?? null,
      recordingFileSize: event.recordingFileSize ? Number(event.recordingFileSize) : null,
      recordingDuration: event.recordingDuration,
      recordingDeleteAfterDays: event.recordingDeleteAfterDays,
      postEventPublic: event.postEventPublic,
      postEventPublicUntil: event.postEventPublicUntil?.toISOString() ?? null,
      postEventShowQA: event.postEventShowQA,
      postEventShowMaterials: event.postEventShowMaterials,
      postEventShowPolls: event.postEventShowPolls,
      postEventShowFeedback: event.postEventShowFeedback,
      feedbackEnabled: event.feedbackEnabled,
      recordingConsentText: event.recordingConsentText,
      moderatorToken: event.moderatorToken,
      moderatorName: event.moderatorName,
      moderatorEmail: event.moderatorEmail,
      jitsiRoomName: event.jitsiRoomName,
      dataRetentionDays: event.dataRetentionDays,
      privacyPolicyUrl: event.privacyPolicyUrl,
      speakersInfo: event.speakersInfo,
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
    recordingUrl: event.recordingPublished ? event.recordingUrl : null,
    tempRecordingUrl: event.status === 'LIVE' ? event.tempRecordingUrl : null,
    tempRecordingStartedAt: event.status === 'LIVE' ? event.tempRecordingStartedAt?.toISOString() ?? null : null,
    postEventPublic: event.postEventPublic,
    postEventShowQA: event.postEventShowQA,
    postEventShowMaterials: event.postEventShowMaterials,
    postEventShowPolls: event.postEventShowPolls,
    postEventShowFeedback: event.postEventShowFeedback,
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

  // Recompute the capacity estimate snapshot when any input that feeds
  // into it changed. Skipped if none of these fields were touched — we
  // don't want an idempotent update (e.g. toggling only `status`) to
  // rewrite the pre-event estimate that autoscalers already read.
  const capacityInputsTouched =
    data.maxParticipants !== undefined ||
    data.startsAt !== undefined ||
    data.endsAt !== undefined ||
    data.recordingEnabled !== undefined ||
    data.participantsCanUnmute !== undefined ||
    data.participantsCanStartVideo !== undefined ||
    data.participantsCanShareScreen !== undefined;

  const nextCapacityEstimate = capacityInputsTouched
    ? {
        ...calculateEstimates({
          maxParticipants: data.maxParticipants ?? event.maxParticipants,
          startsAt:
            data.startsAt ?? event.startsAt.toISOString(),
          endsAt: data.endsAt ?? event.endsAt.toISOString(),
          recordingEnabled:
            data.recordingEnabled ?? event.recordingEnabled,
          participantsCanUnmute:
            data.participantsCanUnmute ?? event.participantsCanUnmute,
          participantsCanStartVideo:
            data.participantsCanStartVideo ?? event.participantsCanStartVideo,
          participantsCanShareScreen:
            data.participantsCanShareScreen ?? event.participantsCanShareScreen,
        }),
        computedAt: new Date().toISOString(),
      }
    : undefined;

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(data.title !== undefined && { title: data.title }),
      ...(data.description !== undefined && { description: data.description }),
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
      ...(data.speakersInfo !== undefined && { speakersInfo: data.speakersInfo }),
      ...(data.organizerName !== undefined && { organizerName: data.organizerName }),
      ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
      ...(data.waitingRoomAudioUrl !== undefined && { waitingRoomAudioUrl: data.waitingRoomAudioUrl }),
      ...(data.postEventPublic !== undefined && { postEventPublic: data.postEventPublic }),
      ...(data.postEventPublicUntil !== undefined && { postEventPublicUntil: data.postEventPublicUntil ? new Date(data.postEventPublicUntil) : null }),
      ...(data.postEventShowQA !== undefined && { postEventShowQA: data.postEventShowQA }),
      ...(data.postEventShowMaterials !== undefined && { postEventShowMaterials: data.postEventShowMaterials }),
      ...(data.postEventShowPolls !== undefined && { postEventShowPolls: data.postEventShowPolls }),
      ...(data.postEventShowFeedback !== undefined && { postEventShowFeedback: data.postEventShowFeedback }),
      ...(data.feedbackEnabled !== undefined && { feedbackEnabled: data.feedbackEnabled }),
      ...(data.recordingConsentText !== undefined && { recordingConsentText: data.recordingConsentText }),
      ...(data.recordingPublished !== undefined && {
        recordingPublished: data.recordingPublished,
        ...(data.recordingPublished ? { recordingPublishedAt: new Date() } : { recordingPublishedAt: null }),
      }),
      ...(data.recordingDeleteAfterDays !== undefined && { recordingDeleteAfterDays: data.recordingDeleteAfterDays }),
      ...(data.recordingUrl !== undefined && { recordingUrl: data.recordingUrl }),
      ...(data.tempRecordingUrl !== undefined && { tempRecordingUrl: data.tempRecordingUrl }),
      ...(data.recordingFileSize !== undefined && { recordingFileSize: data.recordingFileSize }),
      ...(data.recordingDuration !== undefined && { recordingDuration: data.recordingDuration }),
      ...(data.status !== undefined && { status: data.status }),
      ...(nextCapacityEstimate !== undefined && {
        capacityEstimateJson: nextCapacityEstimate,
      }),
      ...(data.joinPassword !== undefined && {
        joinPasswordHash:
          data.joinPassword.length > 0 ? hashJoinPassword(data.joinPassword) : null,
      }),
      ...(data.youtubeUrl !== undefined && { youtubeUrl: data.youtubeUrl }),
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
