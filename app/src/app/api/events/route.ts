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
import { localizedUrl } from '@/lib/utils/localized-url';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { encryptPIIOrNull } from '@/lib/crypto/pii';
import { getPublicEnv } from '@/lib/env';
import { calculateEstimates } from '@/lib/estimates';
import { hashJoinPassword } from '@/lib/auth/password';
import { coerceMatrix, togglesFromMatrix } from '@/lib/utils/permission-matrix';

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

  // If the wizard supplied a permission matrix, keep the boolean toggles
  // in sync so legacy code paths stay correct. Matrix wins when both are
  // present.
  const matrix = data.permissionMatrix ? coerceMatrix(data.permissionMatrix) : null;
  const effectiveToggles = matrix
    ? {
        qaEnabled: togglesFromMatrix(matrix).qaEnabled,
        chatEnabled: togglesFromMatrix(matrix).chatEnabled,
        participantsCanUnmute: togglesFromMatrix(matrix).participantsCanUnmute,
        participantsCanStartVideo: togglesFromMatrix(matrix).participantsCanStartVideo,
        participantsCanShareScreen: togglesFromMatrix(matrix).participantsCanShareScreen,
      }
    : {
        qaEnabled: data.qaEnabled,
        chatEnabled: data.chatEnabled,
        participantsCanUnmute: data.participantsCanUnmute,
        participantsCanStartVideo: data.participantsCanStartVideo,
        participantsCanShareScreen: data.participantsCanShareScreen,
      };

  const slug = await generateUniqueSlug(data.title);
  const jitsiRoomName = `evt-${randomUUID()}`;
  const moderatorToken = randomUUID();

  // Capture the capacity estimate snapshot at creation time. We store it
  // with the event so provisioning workflows (JVB pre-scaling, Jibri
  // availability) can read the expected load without recomputing, and
  // so post-event analytics can diff it against real Prometheus data.
  const capacityEstimate = calculateEstimates({
    maxParticipants: data.maxParticipants,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    recordingEnabled: data.recordingEnabled,
    participantsCanUnmute: data.participantsCanUnmute,
    participantsCanStartVideo: data.participantsCanStartVideo,
    participantsCanShareScreen: data.participantsCanShareScreen,
    expectedSenderRatioPct: data.expectedSenderRatioPct ?? null,
  });

  const event = await prisma.event.create({
    data: {
      slug,
      jitsiRoomName,
      moderatorToken,
      title: data.title,
      description: data.description,
      startsAt: new Date(data.startsAt),
      endsAt: new Date(data.endsAt),
      timezone: data.timezone,
      maxParticipants: data.maxParticipants,
      qaEnabled: effectiveToggles.qaEnabled,
      chatEnabled: effectiveToggles.chatEnabled,
      recordingEnabled: data.recordingEnabled,
      autoStartRecording: data.autoStartRecording,
      participantsCanUnmute: effectiveToggles.participantsCanUnmute,
      participantsCanStartVideo: effectiveToggles.participantsCanStartVideo,
      participantsCanShareScreen: effectiveToggles.participantsCanShareScreen,
      permissionMatrix: matrix ?? undefined,
      recurrenceRule: data.recurrenceRule ?? null,
      recurrenceSeriesId: data.recurrenceSeriesId ?? null,
      dataRetentionDays: data.dataRetentionDays,
      privacyPolicyUrl: data.privacyPolicyUrl,
      privacyPolicyText: data.privacyPolicyText,
      moderatorName: data.moderatorName,
      moderatorEmail: encryptPIIOrNull(data.moderatorEmail),
      speakersInfo: data.speakersInfo,
      organizerName: data.organizerName,
      imageUrl: data.imageUrl,
      waitingRoomAudioUrl: data.waitingRoomAudioUrl,
      parseTitleKicker: data.parseTitleKicker ?? null,
      expectedSenderRatioPct: data.expectedSenderRatioPct ?? null,
      capacityEstimateJson: {
        ...capacityEstimate,
        computedAt: new Date().toISOString(),
      },
      joinPasswordHash:
        data.joinPassword && data.joinPassword.length > 0
          ? hashJoinPassword(data.joinPassword)
          : null,
      ...(data.aiTranscriptEnabled !== undefined && {
        aiTranscriptEnabled: data.aiTranscriptEnabled,
      }),
      ...(data.aiSummaryEnabled !== undefined && {
        aiSummaryEnabled: data.aiSummaryEnabled,
      }),
      ...(data.aiTranslationEnabled !== undefined && {
        aiTranslationEnabled: data.aiTranslationEnabled,
      }),
      ...(data.aiDubbingEnabled !== undefined && {
        aiDubbingEnabled: data.aiDubbingEnabled,
      }),
      ...(data.multitrackRecordingEnabled !== undefined && {
        multitrackRecordingEnabled: data.multitrackRecordingEnabled,
      }),
      ...(data.aiTargetLocales !== undefined && {
        aiTargetLocales: data.aiTargetLocales,
      }),
      ...(data.expectedSpeakers !== undefined && {
        expectedSpeakers: data.expectedSpeakers,
      }),
      // Default reminders: 1 day and 1 hour before
      reminders: {
        create: [
          { offsetMinutes: 1440, label: '1 giorno prima' },
          { offsetMinutes: 60, label: '1 ora prima' },
        ],
      },
    },
  });

  // Attach tags (if the wizard provided slugs). Silently drops unknown
  // slugs — admins curate the tag list via /api/admin/tags separately.
  if (data.tagSlugs && data.tagSlugs.length > 0) {
    const tags = await prisma.tag.findMany({
      where: { slug: { in: data.tagSlugs } },
      select: { id: true },
    });
    if (tags.length > 0) {
      await prisma.eventTagLink.createMany({
        data: tags.map((t) => ({ eventId: event.id, tagId: t.id })),
        skipDuplicates: true,
      });
    }
  }

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const locale = resolveLocale(request);

  await logAdminAction({
    request,
    action: 'EVENT_CREATE',
    target: event.id,
    details: { slug: event.slug, fields: Object.keys(data) },
  });

  return Response.json(
    {
      ...event,
      links: {
        publicPage: localizedUrl(baseUrl, `/events/${event.slug}`, locale),
        moderatorLink: `${baseUrl}/${locale}/admin/events/${event.id}?token=${event.moderatorToken}`,
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
        eventType: event.eventType,
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
      eventType: event.eventType,
      recordingUrl: event.recordingUrl,
    };
  });

  return Response.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
});
