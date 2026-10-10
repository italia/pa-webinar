import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { entiEPersonePubblici, PERSONE_PUBBLICHE_INCLUDE } from '@/lib/events/public-people';
import { vistaResoconto } from '@/lib/report/view';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';
import { isEventOpenForRegistration, isEventPageVisible } from '@/lib/events/visibility';
import { guestAccessAllowed } from '@/lib/events/guest-window';
import { registrationAccessFor } from '@/lib/events/registration-access';
import { materialPhase, materialVisibilityWhere } from '@/lib/events/material-visibility';
import { ensureEventRecap, type EventRecap } from '@/lib/events/recap';
import { getFeedbackSummary } from '@/lib/feedback/feedback-summary';
import EventDetailClient from '@/components/events/event-detail-client';
import { appBaseUrl, getPublicEnv } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { localizedUrl } from '@/lib/utils/localized-url';
import {
  anteprimaEvento,
  firmaPersone,
  immagineAnteprima,
  versioniLinguistiche,
} from '@/lib/events/share-metadata';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { markdownToPlainText } from '@/lib/utils/markdown-text';
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

  const event = await prisma.event.findUnique({
    where: { slug },
    include: PERSONE_PUBBLICHE_INCLUDE,
  });
  // Come la pagina: un evento non pubblico non espone titolo, descrizione
  // e immagine nemmeno nei metadati della risposta «non trovato».
  if (!event || !isEventPageVisible(event)) return { robots: { index: false } };

  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  const pageUrl = localizedUrl(baseUrl, `/events/${slug}`, locale);
  // Titolo, descrizione in testo semplice e immagine (scheda composta dal
  // server o copertina): gli stessi del link della sala e dell'iscrizione.
  const anteprima = anteprimaEvento(
    { ...event, firmaPersone: firmaPersone(event) },
    settings,
    locale,
    `/events/${slug}`,
  );

  return {
    ...anteprima,
    alternates: {
      canonical: pageUrl,
      languages: versioniLinguistiche(`/events/${slug}`, settings.availableLocales),
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
      // Gli enti, e solo chi è stato scelto per la pagina pubblica con un
      // accesso ancora valido.
      ...PERSONE_PUBBLICHE_INCLUDE,
    },
  });

  // PROVISIONING/IDLE (pre-warm/pausa di un evento schedulato) restano
  // raggiungibili: chi apre il link pubblico poco prima dell'inizio non
  // deve trovare un 404. Vedi lib/events/visibility.ts.
  if (!event || !isEventPageVisible(event)) {
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

  // Le due scelte che decidono i pulsanti della scheda: chi può iscriversi,
  // e se in diretta si entra anche senza iscrizione (dell'evento, o del sito).
  const registrationAccess = await registrationAccessFor(
    event,
    settings.publicRegistrationEnabled,
  );
  const guestEntryOpen = guestAccessAllowed(event, settings.guestAccessEnabled);
  // Stessa regola della pagina d'iscrizione e della POST: un evento mai aperto
  // oltre il suo orario di fine non accetta iscrizioni, qualunque stato abbia
  // ancora. Deciso qui con l'orologio del server, così il pulsante non porta a
  // una pagina che risponde 404.
  const registrationOpen = isEventOpenForRegistration(event);

  const title = getLocalized(event.title as LocalizedField, locale);
  // I dati strutturati sono testo: la descrizione senza la sintassi Markdown.
  const description = markdownToPlainText(getLocalized(event.description as LocalizedField, locale));
  const baseUrl = getPublicEnv('NEXT_PUBLIC_APP_URL');
  // La stessa immagine dell'anteprima dei link, come indirizzo assoluto.
  const immagine = immagineAnteprima(
    { ...event, firmaPersone: firmaPersone(event) },
    settings,
    locale,
  ).url;

  // Chi organizza e chi interviene (lib/events/public-people).
  const { enti, persone } = entiEPersonePubblici(event, tryDecryptPII);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description,
    startDate: event.startsAt.toISOString(),
    endDate: event.endsAt.toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    // Un evento concluso non e' annullato: lo dicono le date. La piattaforma
    // non ha uno stato «annullato», quindi l'evento e' sempre in programma.
    eventStatus: 'https://schema.org/EventScheduled',
    ...(immagine ? { image: [immagine.startsWith('/') ? `${baseUrl}${immagine}` : immagine] } : {}),
    location: {
      '@type': 'VirtualLocation',
      url: localizedUrl(baseUrl, `/events/${event.slug}`, locale),
    },
    organizer:
      enti.length > 0
        ? enti.map((e) => ({ '@type': 'Organization', name: e.name, ...(e.websiteUrl ? { url: e.websiteUrl } : {}) }))
        : {
            '@type': 'Organization',
            name: settings.organizationName || 'PA Webinar',
            url: settings.organizationUrl || '',
          },
    ...(persone.some((p) => p.role === 'speaker')
      ? {
          performer: persone
            .filter((p) => p.role === 'speaker')
            .map((p) => ({
              '@type': 'Person',
              name: p.name,
              ...(p.organization ? { affiliation: { '@type': 'Organization', name: p.organization } } : {}),
            })),
        }
      : {}),
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
    answerText: string | null;
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
  // L'invito al questionario post-evento compare solo se l'evento ne ha uno:
  // senza, il modulo chiederebbe al server un questionario che non c'è.
  let hasPostEventQuestionnaire = false;

  if (event.status === 'ENDED') {
    // Generate + persist the aggregate recap on first view (idempotent). Done
    // regardless of the display toggle so it survives retention for the future
    // follow-up email; the page gates DISPLAY on postEventShowRecap below.
    recap = await ensureEventRecap(event.id);
    // Il riepilogo si congela alla prima visita, ma le valutazioni arrivano
    // anche dopo: si leggono al momento. Pubbliche solo se lo sono i feedback.
    if (recap) {
      const valutazioni = event.postEventShowFeedback ? await getFeedbackSummary(event.id) : null;
      recap = {
        ...recap,
        feedback: !valutazioni
          ? { average: null, count: 0 }
          : valutazioni.count >= recap.feedback.count
            ? { average: valutazioni.average, count: valutazioni.count }
            : recap.feedback,
      };
    }

    const [
      materialsRaw,
      questionsRaw,
      pollsRaw,
      valutazioni,
      postEventQuestionnaire,
    ] = await Promise.all([
      // Vista del pubblico: la visibilità del singolo materiale
      // (lib/events/material-visibility) vale anche qui, come nell'API della
      // sala — un materiale «solo durante l'evento» non resta nell'archivio.
      event.postEventShowMaterials
        ? prisma.eventMaterial.findMany({
            where: {
              eventId: event.id,
              ...materialVisibilityWhere(materialPhase(event)),
            },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      event.postEventShowQA && event.qaEnabled
        ? prisma.question.findMany({
            where: {
              eventId: event.id,
              // Anche una domanda rimessa in attesa dopo una risposta scritta:
              // la risposta si vedeva in sala, e resta.
              OR: [
                { status: { in: ['ANSWERED', 'HIGHLIGHTED'] } },
                { status: 'PENDING', answerText: { not: null } },
              ],
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
      event.postEventShowFeedback ? getFeedbackSummary(event.id) : Promise.resolve(null),
      // Il toggle del feedback governa anche l'invito: spento, non serve
      // nemmeno sapere se il questionario c'è.
      event.postEventShowFeedback
        ? prisma.eventQuestionnaire.findUnique({
            where: {
              eventId_placement: { eventId: event.id, placement: 'POST_EVENT' },
            },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    hasPostEventQuestionnaire = !!postEventQuestionnaire;

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
      answerText: q.answerText,
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

    // Una sola media per tutte le pagine (lib/feedback/feedback-summary).
    if (valutazioni && valutazioni.count > 0) feedbackSummary = valutazioni;
  }

  // Prima dell'inizio la scheda è l'unica superficie in cui il pubblico trova
  // i materiali: in sala si entra solo in diretta, dove la fase è già
  // «durante». Qui la vista del pubblico della fase «prima»: SOLO i materiali
  // marcati «Prima dell'evento». Il predefinito vale «in sala e dopo
  // l'evento» e qui non compare (lib/events/material-visibility). Dall'inizio
  // in poi li elencano la sala e, a evento concluso, la scheda post-evento qui
  // sopra.
  if (materialPhase(event) === 'BEFORE') {
    const preEventRaw = await prisma.eventMaterial.findMany({
      where: { eventId: event.id, ...materialVisibilityWhere('BEFORE') },
      orderBy: { createdAt: 'desc' },
    });
    eventMaterials = preEventRaw.map((m) => ({
      id: m.id,
      title: m.title,
      url: m.url,
      description: m.description,
      addedBy: m.addedBy,
      createdAt: m.createdAt.toISOString(),
    }));
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
    transcriptPublished: event.transcriptPublished,
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
    organizers: enti,
    people: persone,
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
        appUrl={appBaseUrl()?.href.replace(/\/$/, '') ?? ''}
        invalidToken={invalidToken}
        hasRoomAccess={hasRoomAccess}
        registrationAccess={registrationAccess}
        registrationOpen={registrationOpen}
        guestEntryOpen={guestEntryOpen}
        hasPostEventQuestionnaire={hasPostEventQuestionnaire}
        report={vistaResoconto(event, locale)}
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
