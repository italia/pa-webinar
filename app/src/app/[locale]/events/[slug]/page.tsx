import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import EventDetailClient from '@/components/events/event-detail-client';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { localizedUrl } from '@/lib/utils/localized-url';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';

export const revalidate = 30;

interface EventDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: EventDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const settings = await (await import('@/lib/settings')).getSettings();

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) return { title: 'Not found' };

  const title = getLocalized(event.title as LocalizedField, locale);
  const description = getLocalized(event.description as LocalizedField, locale);

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const pageUrl = localizedUrl(baseUrl, `/events/${slug}`, locale);

  return {
    title,
    description: description.slice(0, 160),
    openGraph: {
      title,
      description: description.slice(0, 160),
      url: pageUrl,
      type: 'website',
      locale: locale === 'en' ? 'en_GB' : 'it_IT',
      siteName: settings.siteName || 'Eventi PA',
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
        en: `${baseUrl}/en/events/${slug}`,
      },
    },
  };
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { slug } = await params;
  const locale = await getLocale();
  const settings = await getSettings();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: { _count: { select: { registrations: true } } },
  });

  if (!event || !['PUBLISHED', 'LIVE', 'ENDED'].includes(event.status)) {
    notFound();
  }

  const title = getLocalized(event.title as LocalizedField, locale);
  const description = getLocalized(event.description as LocalizedField, locale);
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
      url: localizedUrl(baseUrl, `/events/${event.slug}`, locale),
    },
    organizer: {
      '@type': 'Organization',
      name: settings.organizationName || 'Eventi PA',
      url: settings.organizationUrl || '',
    },
    maximumAttendeeCapacity: event.maxParticipants,
    remainingAttendeeCapacity:
      event.maxParticipants - event._count.registrations,
  };

  // Fetch post-event data for ENDED events
  let eventMaterials: { id: string; title: string; url: string; description: string | null; addedBy: string; createdAt: string }[] = [];
  let answeredQuestions: { id: string; text: string; authorName: string; upvotes: number; status: string }[] = [];
  let pollsData: { id: string; question: string; options: string[]; voteCounts: number[]; totalVotes: number }[] = [];
  let feedbackSummary: { average: number | null; count: number; distribution: { rating: number; count: number }[] } | null = null;

  if (event.status === 'ENDED') {
    const [materialsRaw, questionsRaw, pollsRaw, feedbackAgg, feedbackDist] = await Promise.all([
      event.postEventShowMaterials
        ? prisma.eventMaterial.findMany({
            where: { eventId: event.id },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      event.postEventShowQA && event.qaEnabled
        ? prisma.question.findMany({
            where: {
              eventId: event.id,
              status: { in: ['ANSWERED', 'HIGHLIGHTED'] },
            },
            orderBy: { upvoteCount: 'desc' },
          })
        : Promise.resolve([]),
      event.postEventShowPolls
        ? prisma.poll.findMany({
            where: { eventId: event.id, status: 'PUBLISHED' },
            include: { votes: { select: { optionIndex: true } } },
          })
        : Promise.resolve([]),
      event.postEventShowFeedback
        ? prisma.eventFeedback.aggregate({
            where: { eventId: event.id },
            _avg: { rating: true },
            _count: true,
          })
        : Promise.resolve(null),
      event.postEventShowFeedback
        ? prisma.eventFeedback.groupBy({
            by: ['rating'],
            where: { eventId: event.id },
            _count: true,
            orderBy: { rating: 'desc' },
          })
        : Promise.resolve([]),
    ]);

    eventMaterials = materialsRaw.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    }));

    answeredQuestions = questionsRaw.map((q) => ({
      id: q.id,
      text: q.text,
      authorName: q.authorName,
      upvotes: q.upvoteCount,
      status: q.status,
    }));

    pollsData = pollsRaw.map((p) => {
      const opts = (p.options as string[]) ?? [];
      const voteCounts = opts.map((_, i) =>
        p.votes.filter((v) => v.optionIndex === i).length,
      );
      return {
        id: p.id,
        question: p.question,
        options: opts,
        voteCounts,
        totalVotes: p.votes.length,
      };
    });

    if (feedbackAgg && feedbackAgg._count > 0) {
      feedbackSummary = {
        average: feedbackAgg._avg.rating,
        count: feedbackAgg._count,
        distribution: feedbackDist.map((d) => ({
          rating: d.rating,
          count: d._count,
        })),
      };
    }
  }

  const serialised = {
    id: event.id,
    slug: event.slug,
    title: event.title as Record<string, string>,
    description: event.description as Record<string, string>,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    timezone: event.timezone,
    maxParticipants: event.maxParticipants,
    registrationCount: event._count.registrations,
    status: event.status,
    recordingUrl: event.recordingPublished ? event.recordingUrl : null,
    youtubeUrl: event.youtubeUrl,
    qaEnabled: event.qaEnabled,
    chatEnabled: event.chatEnabled,
    recordingEnabled: event.recordingEnabled,
    participantsCanUnmute: event.participantsCanUnmute,
    participantsCanStartVideo: event.participantsCanStartVideo,
    participantsCanShareScreen: event.participantsCanShareScreen,
    privacyPolicyUrl: event.privacyPolicyUrl,
    speakersInfo: event.speakersInfo as Record<string, string> | null,
    organizerName: event.organizerName,
    imageUrl: event.imageUrl,
    peakParticipants: event.peakParticipants,
    postEventPublic: event.postEventPublic,
    postEventPublicUntil: event.postEventPublicUntil?.toISOString() ?? null,
    postEventShowQA: event.postEventShowQA,
    postEventShowMaterials: event.postEventShowMaterials,
    postEventShowPolls: event.postEventShowPolls,
    postEventShowFeedback: event.postEventShowFeedback,
    dataRetentionDays: event.dataRetentionDays,
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
        parseTitleKicker={resolveKickerEnabled(event, settings.parseTitleKicker)}
        answeredQuestions={answeredQuestions}
        materials={eventMaterials}
        polls={pollsData}
        feedbackSummary={feedbackSummary}
      />
    </>
  );
}
