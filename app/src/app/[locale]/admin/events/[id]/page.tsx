import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import EventManagementClient from '@/components/admin/event-management-client';

interface EventManagePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventManagePage({
  params,
  searchParams,
}: EventManagePageProps) {
  const { id } = await params;
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();

  // Admins navigating from the admin UI (e.g. the recordings library) reach
  // this page without a moderator token. Authenticate via the admin_session
  // cookie instead and fall through to load the event.
  const adminAuthenticated = token ? false : await isAdminAuthenticated(await cookies());

  if (!token && !adminAuthenticated) {
    return (
      <div className="container py-5">
        <h1 className="mb-4">{t('title')}</h1>
        <div className="callout callout-highlight">
          <p>{t('noToken')}</p>
        </div>
      </div>
    );
  }

  // Guard against non-UUID slugs hitting this dynamic route: Next.js picks
  // the [id] segment for any path that doesn't match a sibling static route
  // (e.g. /admin/events/<typo>). Hitting Prisma with a non-UUID throws
  // P2023 Inconsistent column data instead of a clean 404.
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      registrations: {
        select: {
          id: true,
          displayName: true,
          organization: true,
          organizationRole: true,
          organizationType: true,
          joinedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      materials: {
        orderBy: { createdAt: 'desc' },
      },
      reminders: {
        include: { _count: { select: { sentRecords: true } } },
        orderBy: { offsetMinutes: 'desc' },
      },
      gdprAuditLogs: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      _count: { select: { registrations: true } },
    },
  });

  if (!event) {
    notFound();
  }
  if (!adminAuthenticated && event.moderatorToken !== token) {
    notFound();
  }

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  const serialized = {
    id: event.id,
    slug: event.slug,
    title: event.title as Record<string, string>,
    description: event.description as Record<string, string>,
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
    privacyPolicyText: event.privacyPolicyText,
    speakersInfo: event.speakersInfo as Record<string, string> | null,
    createdAt: event.createdAt.toISOString(),
    requireOrganization: event.requireOrganization,
    requireOrganizationRole: event.requireOrganizationRole,
    requireOrganizationType: event.requireOrganizationType,
    registrations: event.registrations.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      organization: r.organization,
      organizationRole: r.organizationRole,
      organizationType: r.organizationType,
      joinedAt: r.joinedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    materials: event.materials.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    })),
    reminders: event.reminders.map((r) => ({
      id: r.id,
      offsetMinutes: r.offsetMinutes,
      label: r.label,
      sentCount: r._count.sentRecords,
      createdAt: r.createdAt.toISOString(),
    })),
    gdprAuditLogs: event.gdprAuditLogs.map((l) => ({
      id: l.id,
      action: l.action,
      recordCount: l.recordCount,
      details: l.details,
      createdAt: l.createdAt.toISOString(),
    })),
  };

  return (
    <div className="container py-5">
      <EventManagementClient
        event={serialized}
        baseUrl={baseUrl}
        locale={locale}
      />
    </div>
  );
}
