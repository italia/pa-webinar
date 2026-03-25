import { notFound, redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import LiveEventClient from '@/components/live/live-event-client';

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
          }}
          token=""
          isModerator={false}
          isGuest={true}
          displayName=""
          locale={locale}
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
    />
  );
}
