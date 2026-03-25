import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import EventDetailClient from '@/components/events/event-detail-client';

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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
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
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <EventDetailClient event={serialised} locale={locale} />
    </>
  );
}
