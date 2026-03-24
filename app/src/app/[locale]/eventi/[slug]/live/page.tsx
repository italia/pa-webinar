import { notFound } from 'next/navigation';
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

  if (!token) {
    notFound();
  }

  const event = await prisma.event.findUnique({
    where: { slug },
  });

  if (!event) {
    notFound();
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

  const serialised = {
    id: event.id,
    slug: event.slug,
    title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    status: event.status,
    recordingEnabled: event.recordingEnabled,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
  };

  return (
    <LiveEventClient
      event={serialised}
      token={token}
      isModerator={isModerator}
      displayName={
        isModerator
          ? event.moderatorName ?? 'Moderatore'
          : participantInfo?.displayName ?? 'Partecipante'
      }
      locale={locale}
    />
  );
}
