import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';
import { isEventPubliclyVisible } from '@/lib/events/visibility';
import { ensureEventRecap, type EventRecap } from '@/lib/events/recap';
import EventDetailClient from '@/components/events/event-detail-client';
import { getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { localizedUrl } from '@/lib/utils/localized-url';
import { openGraphImages, twitterImageCard } from '@/lib/seo';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';

export const revalidate = 30;

interface EventDetailPageProps {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ invalidToken?: string }>;
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
    // Immagine dell'anteprima: la copertina dell'evento se c'è (è la più
    // pertinente per un link condiviso), altrimenti il logo di default. Va
    // messa QUI e non ereditata dal layout: Next sostituisce l'openGraph per
    // segmento, non lo fonde (vedi lib/seo). `settings.seoImage` non entra qui
    // di proposito: è l'immagine del SITO, la copertina dell'evento vince.
    openGraph: {
      title,
      description: description.slice(0, 160),
      url: pageUrl,
      type: 'website',
      locale: locale === 'en' ? 'en_GB' : 'it_IT',
      siteName: settings.siteName || 'PA Webinar',
      images: openGraphImages(event.imageUrl ?? event.coverImageUrl),
    },
    twitter: twitterImageCard(
      title,
      description.slice(0, 160),
      event.imageUrl ?? event.coverImageUrl,
    ),
    alternates: {
      canonical: pageUrl,
      languages: {
        it: `${baseUrl}/it/eventi/${slug}`,
        en: `${baseUrl}/en/events/${slug}`,
      },
    },
  };
}

export default async function EventDetailPage({
  params,
  searchParams,
}: EventDetailPageProps) {
  const { slug } = await params;
  // Letti lato server (la route è già dynamic per il cookies() del layout):
  // un useSearchParams() nel client senza <Suspense> è un build breaker
  // latente il giorno in cui la route torna statica.
  const invalidToken = (await searchParams)?.invalidToken === '1';
  const locale = await getLocale();
  const settings = await getSettings();

  const event = await prisma.event.findUnique({
    where: { slug },
    include: {
      _count: { select: { registrations: true } },
      tagLinks: { include: { tag: true } },
    },
  });

  // PROVISIONING/IDLE (pre-warm/pausa di un evento schedulato) restano
  // raggiungibili: chi apre il link pubblico poco prima dell'inizio non
  // deve trovare un 404. Vedi lib/events/visibility.ts.
  if (!event || !isEventPubliclyVisible(event)) {
    notFound();
  }

  // Cookie d'accesso firmato per-evento (posato alla registrazione): guida la
  // visibilità del link "Entra nella sala" — su evento non-LIVE senza cookie
  // il link porterebbe solo al rimbalzo /live → registrazione → 409.
  // Firma VERIFICATA (stesso check di /live), non semplice presenza: un cookie
  // manomesso o firmato con un APP_SECRET ruotato non deve far apparire un
  // link che poi rimbalza.
  const cookieStore = await cookies();
  const hasRoomAccess = !!(await verifyEventAccess(
    event.id,
    cookieStore.get(eventAccessCookieName(event.id))?.value,
  ));

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
      name: settings.organizationName || 'PA Webinar',
      url: settings.organizationUrl || '',
    },
    maximumAttendeeCapacity: event.maxParticipants,
    remainingAttendeeCapacity: event.maxParticipants - event._count.registrations,
  };

  // Fetch post-event data for ENDED events
  let eventMaterials: {
    id: string;
    title: string;
    url: string;
    description: string | null;
    addedBy: string;
    createdAt: string;
  }[] = [];
  let answeredQuestions: {
    id: string;
    text: string;
    authorName: string;
    upvotes: number;
    status: string;
  }[] = [];
  let pollsData: {
    id: string;
    question: string;
    options: string[];
    voteCounts: number[];
    totalVotes: number;
  }[] = [];
  let feedbackSummary: {
    average: number | null;
    count: number;
    distribution: { rating: number; count: number }[];
  } | null = null;
  let recap: EventRecap | null = null;

  if (event.status === 'ENDED') {
    // Generate + persist the aggregate recap on first view (idempotent). Done
    // regardless of the display toggle so it survives retention for the future
    // follow-up email; the page gates DISPLAY on postEventShowRecap below.
    recap = await ensureEventRecap(event.id);

    const [materialsRaw, questionsRaw, pollsRaw, feedbackAgg, feedbackDist] =
      await Promise.all([
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
      const voteCounts = opts.map(
        (_, i) => p.votes.filter((v) => v.optionIndex === i).length
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

    // Convergence fallback: events created after the feedback redesign
    // collect ratings via the POST_EVENT questionnaire (QuestionnaireResponse),
    // not the legacy EventFeedback table. When there is no legacy feedback,
    // derive the public star summary from the questionnaire's 1-5 LIKERT
    // answers (averaged across all rating questions) so the public Feedback
    // tab keeps working for new events.
    if (!feedbackSummary && event.postEventShowFeedback) {
      const pq = await prisma.eventQuestionnaire.findUnique({
        where: { eventId_placement: { eventId: event.id, placement: 'POST_EVENT' } },
        select: {
          _count: { select: { responses: true } },
          responses: {
            select: {
              answers: {
                select: { valueScale: true, item: { select: { type: true } } },
              },
            },
          },
        },
      });
      if (pq && pq._count.responses > 0) {
        const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        let n = 0;
        for (const r of pq.responses) {
          for (const a of r.answers) {
            if (
              a.item.type === 'LIKERT' &&
              a.valueScale != null &&
              a.valueScale >= 1 &&
              a.valueScale <= 5
            ) {
              counts[a.valueScale] = (counts[a.valueScale] ?? 0) + 1;
              sum += a.valueScale;
              n += 1;
            }
          }
        }
        if (n > 0) {
          feedbackSummary = {
            average: sum / n,
            count: pq._count.responses,
            distribution: [5, 4, 3, 2, 1].map((rating) => ({
              rating,
              count: counts[rating] ?? 0,
            })),
          };
        }
      }
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
    postEventShowRecap: event.postEventShowRecap,
    postEventShowWordCloud: event.postEventShowWordCloud,
    dataRetentionDays: event.dataRetentionDays,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <EventDetailClient
        event={serialised}
        locale={locale}
        invalidToken={invalidToken}
        hasRoomAccess={hasRoomAccess}
        parseTitleKicker={resolveKickerEnabled(event, settings.parseTitleKicker)}
        answeredQuestions={answeredQuestions}
        materials={eventMaterials}
        polls={pollsData}
        feedbackSummary={feedbackSummary}
        recap={recap}
        tags={event.tagLinks.map((l) => ({
          slug: l.tag.slug,
          name: (l.tag.name ?? {}) as Record<string, string>,
          color: l.tag.color,
        }))}
      />
    </>
  );
}
