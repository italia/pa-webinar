import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { prisma } from '@/lib/db';
import { verifyRatingToken } from '@/lib/feedback/rating-link';
import { tryDecryptPII } from '@/lib/crypto/pii';
import { entiEPersonePubblici, PERSONE_PUBBLICHE_INCLUDE } from '@/lib/events/public-people';
import { orariProgramma, relatoreDelProgramma, type VoceProgramma } from '@/lib/agenda/programme';
import { vistaResoconto } from '@/lib/report/view';
import { eventAccessCookieName, verifyEventAccess } from '@/lib/event-session';
import { isEventOpenForRegistration, isEventPageVisible } from '@/lib/events/visibility';
import { guestAccessAllowed } from '@/lib/events/guest-window';
import { registrationAccessFor } from '@/lib/events/registration-access';
import { materialPhase, materialVisibilityWhere } from '@/lib/events/material-visibility';
import { ensureEventRecap, type EventRecap } from '@/lib/events/recap';
import type { RecordingSlidesView } from '@/lib/presentation/recording-slides';
import { publicRecordingSlides } from '@/lib/presentation/recording-slides-data';
import { getFeedbackSummary } from '@/lib/feedback/feedback-summary';
import EventDetailClient from '@/components/events/event-detail-client';
import { linguaPrincipale, lingueTradotteInAutomatico } from '@/lib/text-translation/stato-lingue';
import { appBaseUrl, getPublicEnv } from '@/lib/env';
import { isEventManager } from '@/lib/auth/staff-session';
import { accessoRegistrazione, pubblicazioneAperta } from '@/lib/recording/audience';
import {
  programmeVideoTimes,
  replayMoments,
  type ProgrammeVideoTime,
  type ReplayMoment,
} from '@/lib/replay/moments';
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
  searchParams?: Promise<{ invalidToken?: string; valuta?: string; anteprima?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: EventDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  // L'anteprima per lo staff non si indicizza.
  const inAnteprima = (await searchParams)?.anteprima === '1';
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
    ...(inAnteprima && { robots: { index: false, follow: false } }),
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
  const parametri = await searchParams;
  const invalidToken = parametri?.invalidToken === '1';
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
      // Il programma: tutti gli argomenti in ordine, con chi interviene.
      // Della persona si legge se è presentata e non revocata: il nome esce
      // solo allora (relatoreDelProgramma).
      agendaItems: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          label: true,
          plannedMinutes: true,
          status: true,
          speakerGrantId: true,
          speakerPrimary: true,
          speaker: {
            select: {
              name: true,
              organization: true,
              photoId: true,
              publicListed: true,
              revokedAt: true,
            },
          },
        },
      },
    },
  });

  if (!event) notFound();
  const cookieStore = await cookies();

  // PROVISIONING/IDLE (pre-warm/pausa di un evento schedulato) restano
  // raggiungibili: chi apre il link pubblico poco prima dell'inizio non
  // deve trovare un 404. Vedi lib/events/visibility.ts. Lo staff che
  // gestisce l'evento la apre anche nascosta, in anteprima (`?anteprima=1`).
  const paginaVisibile = isEventPageVisible(event);
  const chiedeAnteprima = parametri?.anteprima === '1';
  if (!paginaVisibile && !(chiedeAnteprima && (await isEventManager(cookieStore, event.id)))) {
    notFound();
  }

  // Cookie d'accesso firmato per-evento (posato alla registrazione): guida la
  // visibilità del link "Entra nella sala" — su evento non-LIVE senza cookie
  // il link porterebbe solo al rimbalzo /live → registrazione → 409.
  // Firma VERIFICATA (stesso check di /live), non semplice presenza: un cookie
  // manomesso o firmato con un APP_SECRET ruotato non deve far apparire un
  // link che poi rimbalza.
  const hasRoomAccess = !!(await verifyEventAccess(
    event.id,
    cookieStore.get(eventAccessCookieName(event.id))?.value,
  ));

  // Chi vede la registrazione e cio' che ne deriva (lib/recording/audience):
  // tutti o i soli iscritti, se pubblicata; lo staff che gestisce l'evento
  // anche prima, ma solo quando chiede l'anteprima (`?anteprima=1`), cosi'
  // la pagina che guarda di solito e' quella di tutti.
  const accesso = event.status === 'ENDED' ? await accessoRegistrazione(event, cookieStore) : null;
  const aperta = pubblicazioneAperta(event);
  const previewForStaff = accesso === 'staff' && chiedeAnteprima && (!aperta || !paginaVisibile);
  const vedeRegistrazione =
    accesso === 'pubblico' || accesso === 'iscritto' || (accesso === 'staff' && (aperta || previewForStaff));
  const videoVisibile = vedeRegistrazione && (event.recordingPublished || previewForStaff);
  const recordingForRegistrants =
    event.status === 'ENDED' && aperta && event.recordingAudience === 'REGISTRANTS' && !vedeRegistrazione;

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

  // Il programma preparato prima dell'evento, se l'agenda è accesa. Di chi
  // interviene solo cio' che la pagina mostra gia' (persona presentata).
  const programma: VoceProgramma[] = event.agendaEnabled
    ? event.agendaItems.map((a) => ({
        id: a.id,
        label: a.label,
        plannedMinutes: a.plannedMinutes,
        status: a.status,
        speaker: relatoreDelProgramma(a, event, tryDecryptPII),
      }))
    : [];
  const orariDelProgramma = orariProgramma(event.startsAt, programma);
  const luogo = {
    '@type': 'VirtualLocation',
    url: localizedUrl(baseUrl, `/events/${event.slug}`, locale),
  };

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
    location: luogo,
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
              ...(p.photoUrl ? { image: `${baseUrl}${p.photoUrl}` } : {}),
              ...(p.organization ? { affiliation: { '@type': 'Organization', name: p.organization } } : {}),
            })),
        }
      : {}),
    maximumAttendeeCapacity: event.maxParticipants,
    remainingAttendeeCapacity: event.maxParticipants - event._count.registrations,
    // Gli argomenti del programma, con gli orari solo quando si conoscono e
    // chi interviene solo se la pagina lo presenta.
    ...(programma.length > 0
      ? {
          subEvent: programma.map((v, i) => {
            const { start, end } = orariDelProgramma[i]!;
            return {
              '@type': 'Event',
              name: v.label,
              eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
              location: luogo,
              ...(start ? { startDate: start.toISOString() } : {}),
              ...(end ? { endDate: end.toISOString() } : {}),
              ...(v.speaker
                ? {
                    performer: {
                      '@type': 'Person',
                      name: v.speaker.name,
                      ...(v.speaker.organization
                        ? { affiliation: { '@type': 'Organization', name: v.speaker.organization } }
                        : {}),
                    },
                  }
                : {}),
            };
          }),
        }
      : {}),
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
  let feedbackProof: { accessToken?: string; ratingToken?: string } | null = null;
  // Le slide presentate in sala accanto al video pubblicato
  // (lib/presentation/recording-slides-data).
  let recordingSlides: RecordingSlidesView | null = null;
  let momenti: ReplayMoment[] | null = null;
  let orariNelVideo: Record<string, ProgrammeVideoTime> | null = null;

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

    // Un contorno del video: se non si leggono, la pagina resta quella di
    // sempre, con il video senza slide.
    if (videoVisibile && event.recordingUrl) {
      try {
        recordingSlides = await publicRecordingSlides({ ...event, recordingPublished: true });
      } catch (err) {
        console.error(
          '[events/page] slide della registrazione non lette',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // La valutazione dalla pagina pubblica: solo per un iscritto entrato in
    // sala, riconosciuto dal link della valutazione dell'email di
    // ringraziamento (?valuta=, lib/feedback/rating-link) o dal cookie
    // d'accesso del browser con cui si e' iscritto. Chi e' entrato da ospite
    // valuta in sala, alla fine (lib/feedback/participation).
    if (hasPostEventQuestionnaire) {
      const dalLink =
        typeof parametri?.valuta === 'string' ? verifyRatingToken(parametri.valuta, event.id) : null;
      if (dalLink) {
        const iscrizione = await prisma.registration.findUnique({
          where: { id: dalLink },
          select: { eventId: true, joinedAt: true },
        });
        if (iscrizione?.eventId === event.id && iscrizione.joinedAt) feedbackProof = { ratingToken: parametri!.valuta! };
      }
      const candidato = feedbackProof
        ? null
        : await verifyEventAccess(event.id, cookieStore.get(eventAccessCookieName(event.id))?.value);
      if (candidato) {
        const iscrizione = await prisma.registration.findUnique({
          where: { accessToken: candidato },
          select: { eventId: true, joinedAt: true },
        });
        if (iscrizione?.eventId === event.id && iscrizione.joinedAt) feedbackProof = { accessToken: candidato };
      }
    }

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

    // I momenti della diretta e il programma come indice della registrazione,
    // sul tempo del video, con il contenuto che la pagina mostra gia'
    // (lib/replay/moments). Uno che non si legge non toglie l'altro.
    if (videoVisibile && event.recordingUrl) {
      const [momentiLetti, orariLetti] = await Promise.allSettled([
        replayMoments(event, {
          questions: questionsRaw,
          polls: pollsData,
          materials: materialsRaw.map((m) => ({ id: m.id, title: m.title })),
          showWordCloud: event.postEventShowWordCloud,
        }),
        programma.length > 0 ? programmeVideoTimes(event) : Promise.resolve(null),
      ]);
      if (momentiLetti.status === 'fulfilled') momenti = momentiLetti.value;
      else console.error('[events/page] momenti della diretta non letti', String(momentiLetti.reason));
      if (orariLetti.status === 'fulfilled') orariNelVideo = orariLetti.value;
      else console.error('[events/page] programma nel video non letto', String(orariLetti.reason));
    }
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
    recordingUrl: videoVisibile ? event.recordingUrl : null,
    transcriptPublished: vedeRegistrazione && event.transcriptPublished,
    // Il video su YouTube e' fuori dalla piattaforma: il pubblico della
    // registrazione non lo governa.
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
    programme: programma,
    // Solo le lingue, mai gli stati e le impronte.
    lingueAutomatiche: lingueTradotteInAutomatico(
      event.textLocaleState,
      event.title as Record<string, string>,
      event.description as Record<string, string>,
      linguaPrincipale(settings),
    ),
    linguaPrincipale: linguaPrincipale(settings),
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
        replayMoments={momenti}
        programmeVideoTimes={orariNelVideo}
        previewForStaff={previewForStaff}
        recordingForRegistrants={recordingForRegistrants}
        hasRoomAccess={hasRoomAccess}
        registrationAccess={registrationAccess}
        registrationOpen={registrationOpen}
        guestEntryOpen={guestEntryOpen}
        hasPostEventQuestionnaire={hasPostEventQuestionnaire}
        feedbackProof={feedbackProof}
        report={vistaResoconto(event, locale)}
        parseTitleKicker={resolveKickerEnabled(event, settings.parseTitleKicker)}
        answeredQuestions={answeredQuestions}
        materials={eventMaterials}
        polls={pollsData}
        feedbackSummary={feedbackSummary}
        recap={recap}
        recordingSlides={recordingSlides}
        tags={event.tagLinks.map((l) => ({
          slug: l.tag.slug,
          name: (l.tag.name ?? {}) as Record<string, string>,
          color: l.tag.color,
        }))}
      />
    </>
  );
}
