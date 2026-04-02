import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import EventDetailClient from '@/components/events/event-detail-client';
import { getPublicEnv } from '@/lib/env';

interface EventDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: EventDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) return { title: 'Not found' };

  const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
  const description =
    locale === 'en' && event.descriptionEn
      ? event.descriptionEn
      : event.descriptionIt;

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const pageUrl = `${baseUrl}/${locale}/eventi/${slug}`;

  return {
    title,
    description: description.slice(0, 160),
    openGraph: {
      title,
      description: description.slice(0, 160),
      url: pageUrl,
      type: 'website',
      locale: locale === 'en' ? 'en_GB' : 'it_IT',
      siteName: 'Eventi DTD',
    },
    twitter: {
      card: 'summary',
      title,
      description: description.slice(0, 160),
    },
    alternates: {
      canonical: pageUrl,
      languages: {
        it: `${baseUrl}/it/eventi/${slug}`,
        en: `${baseUrl}/en/eventi/${slug}`,
      },
    },
  };
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { slug } = await params;
  const locale = await getLocale();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event || !['PUBLISHED', 'LIVE', 'ENDED'].includes(event.status)) {
    notFound();
  }

  const title = locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
  const description =
    locale === 'en' && event.descriptionEn
      ? event.descriptionEn
      : event.descriptionIt;
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description,
    startDate: event.startsAt.toISOString(),
    endDate: event.endsAt.toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus:
      event.status === 'ENDED'
        ? 'https://schema.org/EventCancelled'
        : 'https://schema.org/EventScheduled',
    location: {
      '@type': 'VirtualLocation',
      url: `${baseUrl}/${locale}/eventi/${event.slug}`,
    },
    organizer: {
      '@type': 'Organization',
      name: 'Dipartimento per la Trasformazione Digitale',
      url: 'https://innovazione.gov.it',
    },
    maximumAttendeeCapacity: event.maxParticipants,
    remainingAttendeeCapacity:
      event.maxParticipants - event._count.registrations,
  };

  // Fetch materials for ended events
  let eventMaterials: { id: string; title: string; url: string; description: string | null; addedBy: string; createdAt: string }[] = [];
  if (event.status === 'ENDED') {
    const materials = await prisma.eventMaterial.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: 'desc' },
    });
    eventMaterials = materials.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  // Fetch answered/highlighted Q&A for ended events
  let answeredQuestions: { id: string; text: string; authorName: string; upvotes: number; status: string }[] = [];
  if (event.status === 'ENDED' && event.qaEnabled) {
    const questions = await prisma.question.findMany({
      where: {
        eventId: event.id,
        status: { in: ['ANSWERED', 'HIGHLIGHTED'] },
      },
      orderBy: { upvoteCount: 'desc' },
    });
    answeredQuestions = questions.map((q) => ({
      id: q.id,
      text: q.text,
      authorName: q.authorName,
      upvotes: q.upvoteCount,
      status: q.status,
    }));
  }

  const serialised = {
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
    status: event.status,
    recordingUrl: event.recordingUrl,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
    privacyPolicyUrl: event.privacyPolicyUrl,
    speakersIt: event.speakersIt,
    speakersEn: event.speakersEn,
    organizerName: event.organizerName,
    imageUrl: event.imageUrl,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <EventDetailClient
        event={serialised}
        locale={locale}
        answeredQuestions={answeredQuestions}
        materials={eventMaterials}
      />
    </>
  );
}
