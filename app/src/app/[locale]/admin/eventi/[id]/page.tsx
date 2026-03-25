import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import EventManagementClient from '@/components/admin/event-management-client';

interface EventManagePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function EventManagePage({
  params,
  searchParams,
}: EventManagePageProps) {
  const { id } = await params;
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const locale = await getLocale();

  if (!token) {
    return (
      <div className="container py-5">
        <h1 className="mb-4">{t('title')}</h1>
        <div className="callout callout-highlight">
          <p>{t('noToken')}</p>
        </div>
      </div>
    );
  }

  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      registrations: {
        select: {
          id: true,
          displayName: true,
          joinedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      },
      _count: { select: { registrations: true } },
    },
  });

  if (!event || event.moderatorToken !== token) {
    notFound();
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const serialized = {
    id: event.id,
    slug: event.slug,
    titleIt: event.titleIt,
    titleEn: event.titleEn,
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
    createdAt: event.createdAt.toISOString(),
    registrations: event.registrations.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      joinedAt: r.joinedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
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
