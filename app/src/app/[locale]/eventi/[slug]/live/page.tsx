import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { isJibriAvailable } from '@/lib/infrastructure';
import LiveEventClient from '@/components/live/live-event-client';

export const dynamic = 'force-dynamic';

interface LivePageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string }>;
}

export default async function LivePage({ params, searchParams }: LivePageProps) {
  const { slug } = await params;
  const { token } = await searchParams;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({
    where: { slug },
  });

  if (!event) {
    notFound();
  }

  const settings = await getSettings();
  const jibriAvailable = await isJibriAvailable();

  const watermark = {
    url: settings.jitsiWatermarkUrl || settings.logoUrl || '/images/dtd-watermark.svg',
    enabled: settings.jitsiWatermarkEnabled,
    opacity: settings.jitsiWatermarkOpacity,
    position: settings.jitsiWatermarkPosition,
  };

  // No token: guest access or redirect
  if (!token) {
    if (event.status === 'LIVE') {
      const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
      return (
        <LiveEventClient
          event={{
            id: event.id,
            slug: event.slug,
            title,
            startsAt: event.startsAt.toISOString(),
            endsAt: event.endsAt.toISOString(),
            status: event.status,
            recordingEnabled: event.recordingEnabled,
            qaEnabled: event.qaEnabled,
            chatEnabled: event.chatEnabled,
            waitingRoomAudioUrl: event.waitingRoomAudioUrl,
            participantsCanUnmute: event.participantsCanUnmute,
            participantsCanStartVideo: event.participantsCanStartVideo,
            participantsCanShareScreen: event.participantsCanShareScreen,
            timezone: event.timezone,
          }}
          token=""
          isModerator={false}
          isGuest={true}
          displayName=""
          locale={locale}
          jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
          watermark={watermark}
          jibriAvailable={jibriAvailable}
        />
      );
    }
    redirect(`/${locale}/eventi/${slug}/registrazione`);
  }

  const isModerator = event.moderatorToken === token;

  let participantInfo: { displayName: string } | null = null;
  if (!isModerator) {
    const registration = await prisma.registration.findUnique({
      where: { accessToken: token },
      select: { displayName: true, eventId: true },
    });

    if (!registration || registration.eventId !== event.id) {
      notFound();
    }
    participantInfo = { displayName: registration.displayName };
  }

  const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;

  return (
    <LiveEventClient
      event={{
        id: event.id,
        slug: event.slug,
        title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        status: event.status,
        recordingEnabled: event.recordingEnabled,
        qaEnabled: event.qaEnabled,
        chatEnabled: event.chatEnabled,
        waitingRoomAudioUrl: event.waitingRoomAudioUrl,
        participantsCanUnmute: event.participantsCanUnmute,
        participantsCanStartVideo: event.participantsCanStartVideo,
        participantsCanShareScreen: event.participantsCanShareScreen,
        timezone: event.timezone,
      }}
      token={token}
      isModerator={isModerator}
      isGuest={false}
      displayName={
        isModerator
          ? event.moderatorName ?? 'Moderatore'
          : participantInfo?.displayName ?? 'Partecipante'
      }
      locale={locale}
      jitsiDomain={getPublicEnv('NEXT_PUBLIC_JITSI_DOMAIN')}
      watermark={watermark}
      jibriAvailable={jibriAvailable}
    />
  );
}
