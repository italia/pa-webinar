/**
 * POST /api/admin/events/:id/duplicate
 *
 * Admin-only: creates a DRAFT copy of an existing event so an operator
 * can tweak the next occurrence without re-entering all the config
 * (privacy policy, feature toggles, speakers, branding, …).
 *
 * What we copy: all authored content — titles (with "(copia)" appended),
 * description, schedule, feature toggles, registration rules, privacy
 * text, speakers/organiser info, GDPR template link, cover image, event
 * type, sizing overrides.
 *
 * What we reset: status (→ DRAFT), moderatorToken, jitsiRoomName, slug,
 * runtime/analytics state (lastActiveAt, provisioningStartedAt,
 * peakParticipants, recording URLs/metadata, capacityEstimateJson).
 *
 * What we skip: relations (registrations, questions, polls, materials,
 * reminders, feedback, sessions). The duplicate is a blank canvas.
 */
import { randomUUID } from 'crypto';

import { cookies } from 'next/headers';

import { withErrorHandling } from '@/lib/api-handler';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { logAdminAction } from '@/lib/audit/admin-audit';
import { prisma } from '@/lib/db';
import { AppError, NotFoundError, UnauthorizedError } from '@/lib/errors';
import { generateUniqueSlug } from '@/lib/utils/slug';
import type { LocalizedField } from '@/lib/utils/locale';

export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Append "(copia)" / "(copy)" to each locale's title so the duplicate
 * is visually distinct in event lists. Non-standard locales get the
 * Italian suffix (admin UI is primarily IT).
 */
function suffixTitle(title: LocalizedField): Record<string, string> {
  if (!title || typeof title !== 'object') {
    return { it: '(copia)' };
  }
  const out: Record<string, string> = {};
  for (const [locale, value] of Object.entries(title)) {
    if (typeof value !== 'string') continue;
    const suffix = locale === 'en' ? '(copy)' : '(copia)';
    out[locale] = value.trim().length > 0 ? `${value} ${suffix}` : suffix;
  }
  return out;
}

export const POST = withErrorHandling(async (request, context) => {
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) throw new UnauthorizedError();

  const { id } = await context.params;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new AppError('id must be a UUID', 400, 'BAD_REQUEST');
  }

  const source = await prisma.event.findUnique({ where: { id } });
  if (!source) throw new NotFoundError('Event not found');

  const newTitle = suffixTitle(source.title as LocalizedField);
  const newSlug = await generateUniqueSlug(newTitle);
  const moderatorToken = randomUUID();
  const jitsiRoomName = `evt-${randomUUID()}`;

  const duplicate = await prisma.event.create({
    data: {
      slug: newSlug,
      jitsiRoomName,
      moderatorToken,
      status: 'DRAFT',

      title: newTitle,
      description: source.description ?? {},

      startsAt: source.startsAt,
      endsAt: source.endsAt,
      timezone: source.timezone,

      maxParticipants: source.maxParticipants,
      expectedSenderRatioPct: source.expectedSenderRatioPct,
      gracePeriodMinutes: source.gracePeriodMinutes,

      qaEnabled: source.qaEnabled,
      chatEnabled: source.chatEnabled,
      recordingEnabled: source.recordingEnabled,

      participantsCanUnmute: source.participantsCanUnmute,
      participantsCanStartVideo: source.participantsCanStartVideo,
      participantsCanShareScreen: source.participantsCanShareScreen,
      // Preserve the role×feature matrix exactly (not just the GUEST-projected
      // booleans above) so a duplicate keeps any SPEAKER-specific grants.
      permissionMatrix: source.permissionMatrix ?? undefined,

      requireOrganization: source.requireOrganization,
      requireOrganizationRole: source.requireOrganizationRole,
      requireOrganizationType: source.requireOrganizationType,

      moderatorName: source.moderatorName,
      moderatorEmail: source.moderatorEmail,

      dataRetentionDays: source.dataRetentionDays,
      privacyPolicyUrl: source.privacyPolicyUrl,
      privacyPolicyText: source.privacyPolicyText,
      gdprTemplateId: source.gdprTemplateId,
      recordingConsentText: source.recordingConsentText,

      speakersInfo: source.speakersInfo ?? {},
      organizerName: source.organizerName,
      imageUrl: source.imageUrl,
      coverImageUrl: source.coverImageUrl,
      waitingRoomAudioUrl: source.waitingRoomAudioUrl,

      eventType: source.eventType,

      postEventPublic: source.postEventPublic,
      postEventShowQA: source.postEventShowQA,
      postEventShowMaterials: source.postEventShowMaterials,
      postEventShowPolls: source.postEventShowPolls,
      postEventShowFeedback: source.postEventShowFeedback,
      feedbackEnabled: source.feedbackEnabled,

      youtubeUrl: source.youtubeUrl,
      libraryListed: source.libraryListed,
    },
  });

  await logAdminAction({
    request,
    action: 'EVENT_DUPLICATE',
    target: duplicate.id,
    details: { sourceId: source.id },
  });

  return Response.json(
    {
      id: duplicate.id,
      slug: duplicate.slug,
      moderatorToken: duplicate.moderatorToken,
    },
    { status: 201 },
  );
});
