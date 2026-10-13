'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Alert, Button, Card, CardBody, Row, Col } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link, percorso } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import type { EntePubblico, PersonaPubblica } from '@/lib/events/public-people';
import { youtubeWatchLink } from '@/lib/utils/youtube-link';
import AddToCalendar from '@/components/events/add-to-calendar';
import VideoPlayer, {
  type VideoPlayerHandle,
  type SubtitleTrack,
  type AudioTrack,
} from '@/components/events/video-player';
import PostEventTabs from '@/components/events/post-event-tabs';
import MaterialList from '@/components/materials/material-list';
import PostEventRecap from '@/components/events/post-event-recap';
import PostEventReport from '@/components/events/report/post-event-report';
import { isRecapEmpty, type EventRecap } from '@/lib/events/recap';
import type { RegistrationAccess } from '@/lib/events/registration-access';
import PostEventFeedbackInvite from '@/components/events/post-event-feedback-invite';
import PostEventHero, {
  type StructuredSummary,
} from '@/components/events/post-event-hero';
import type { PipelineSnapshot } from '@/components/events/pipeline-provenance';
import NowSpeakingChip from '@/components/events/now-speaking-chip';
import VideoMiniPlayer from '@/components/events/video-mini-player';
import MiniTranscript from '@/components/events/mini-transcript';
import BookmarksPanel from '@/components/events/bookmarks-panel';
import { useDeepLinkSeek } from '@/lib/utils/use-deep-link';
import { localeDisplayName as locName } from '@/lib/utils/locale-display';
import type { ReportView } from '@/lib/report/types';
import EventHeader, { EventPeople, type TagChip } from '@/components/events/event-header';
import { MarkdownRenderer } from '@/components/ui/markdown';

interface AnsweredQuestion {
  id: string;
  text: string;
  answerText: string | null;
  authorName: string;
  upvotes: number;
  status: string;
}

interface EventData {
  id: string;
  slug: string;
  title: Record<string, string>;
  description: Record<string, string>;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  status: string;
  recordingUrl: string | null;
  /** La trascrizione si legge anche senza il video pubblicato. */
  transcriptPublished?: boolean;
  youtubeUrl?: string | null;
  qaEnabled: boolean;
  chatEnabled: boolean;
  recordingEnabled?: boolean;
  participantsCanUnmute?: boolean;
  participantsCanStartVideo?: boolean;
  participantsCanShareScreen?: boolean;
  privacyPolicyUrl: string | null;
  speakersInfo: Record<string, string> | null;
  organizerName: string | null;
  /** Gli enti che organizzano e le persone pubblicate (lib/events/public-people). */
  organizers?: EntePubblico[];
  people?: PersonaPubblica[];
  imageUrl: string | null;
  peakParticipants?: number;
  postEventPublic?: boolean;
  postEventPublicUntil?: string | null;
  postEventShowQA?: boolean;
  postEventShowMaterials?: boolean;
  postEventShowPolls?: boolean;
  postEventShowFeedback?: boolean;
  postEventShowRecap?: boolean;
  postEventShowWordCloud?: boolean;
  dataRetentionDays?: number;
}

interface MaterialData {
  id: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  createdAt: string;
}

interface PollData {
  id: string;
  question: string;
  options: string[];
  voteCounts: number[];
  totalVotes: number;
}

interface FeedbackSummary {
  average: number | null;
  count: number;
  distribution: { rating: number; count: number }[];
}

interface EventDetailClientProps {
  event: EventData;
  locale: string;
  /** Origine pubblica dell'app, per i link assoluti del calendario. */
  appUrl: string;
  parseTitleKicker?: boolean;
  answeredQuestions?: AnsweredQuestion[];
  /** Materiali già filtrati dal server per il pubblico: quelli della fase
   *  «prima» prima dell'inizio, quelli post-evento a evento concluso,
   *  nessuno nel mezzo (li elenca la sala). */
  materials?: MaterialData[];
  polls?: PollData[];
  feedbackSummary?: FeedbackSummary | null;
  recap?: EventRecap | null;
  tags?: TagChip[];
  /** /live ci ha rimbalzato qui per un token personale non più valido. Letto
   *  dal server (searchParams): useSearchParams() senza <Suspense> è un build
   *  breaker latente su route statiche. */
  invalidToken?: boolean;
  /** Il device ha il cookie d'accesso firmato per questo evento: il link
   *  "Entra nella sala" può re-identificarlo su /live. */
  hasRoomAccess?: boolean;
  /** Chi può iscriversi (lib/events/registration-access). */
  registrationAccess?: RegistrationAccess;
  /** L'evento accetta iscrizioni adesso: `isEventOpenForRegistration`
   *  (lib/events/visibility) calcolato dal server, che conosce l'ora. Falso su
   *  un evento non concluso vuol dire che l'orario di fine è passato senza che
   *  la sala si aprisse. */
  registrationOpen: boolean;
  /** In diretta si entra anche senza iscrizione (lib/events/guest-window). */
  guestEntryOpen?: boolean;
  /** L'evento ha un questionario post-evento: solo allora compare l'invito. */
  hasPostEventQuestionnaire?: boolean;
  /** La prova di chi ha partecipato, se il server l'ha riconosciuta (link
   *  personale o link della valutazione): con questa la pagina offre la
   *  valutazione di fine evento. */
  feedbackProof?: { accessToken?: string; ratingToken?: string } | null;
  /** Il resoconto dell'evento, se lo staff l'ha pubblicato (lib/report). */
  report?: ReportView | null;
}

/** Display name for ISO language codes, used in the subtitle / audio
 *  switcher menus. Uses Intl.DisplayNames con fallback al codice se
 *  Intl non riconosce il tag. */
function localeDisplayName(lang: string): string {
  try {
    const n = new Intl.DisplayNames(['it'], { type: 'language' });
    return n.of(lang) ?? lang.toUpperCase();
  } catch {
    return lang.toUpperCase();
  }
}

export default function EventDetailClient({
  event,
  locale,
  appUrl,
  parseTitleKicker = false,
  answeredQuestions = [],
  materials = [],
  polls = [],
  feedbackSummary = null,
  recap = null,
  tags = [],
  invalidToken = false,
  hasRoomAccess = false,
  registrationAccess = 'open',
  registrationOpen,
  guestEntryOpen = true,
  hasPostEventQuestionnaire = false,
  feedbackProof = null,
  report = null,
}: EventDetailClientProps) {
  const t = useTranslations('events');
  const tr = useTranslations('registration');
  const tl = useTranslations('live');
  const svegliaPonte = () => {
    // 1a: anticipa il risveglio del bridge (JVB) al
    // momento del click, prima di navigazione + idratazione
    // di /live — così il pre-warm parte qualche secondo
    // prima. L'endpoint wake è idempotente e no-op se
    // l'evento è già LIVE.
    void fetch(`/api/events/${event.slug}/wake`, {
      method: 'POST',
    }).catch(() => {});
  };
  const tv = useTranslations('video');
  const tm = useTranslations('materials');
  const tPostprod = useTranslations('postprod');
  const format = useFormatter();

  // Ref del player — usato dal TranscriptPanel per click-to-seek + da
  // future feature live (es. timestamp deeplink ?t=120).
  const playerRef = useRef<VideoPlayerHandle>(null);
  const playerAnchorRef = useRef<HTMLDivElement>(null);
  useDeepLinkSeek(playerRef);
  // Lingua attiva dei sottotitoli — guida quale variante di summary
  // mostrare nel TranscriptPanel ("la sintesi nella lingua che stai
  // guardando").
  const [activeTranscriptLanguage, setActiveTranscriptLanguage] = useState<string | null>(
    null
  );
  // Metadata postprod (subtitle/audio tracks disponibili, transcript
  // endpoint). Fetched solo per recording pubblicate; se la fetch
  // fallisce o ritorna 404 (postprod non abilitato per l'evento) i
  // tracks restano vuoti e il player gira nudo come prima.
  const [postprodMeta, setPostprodMeta] = useState<{
    subtitleTracks?: SubtitleTrack[];
    audioTracks?: AudioTrack[];
    transcriptAvailable: boolean;
    summariesStructured?: Record<string, StructuredSummary>;
    /** Lightweight segments shape per il NowSpeakingChip (no words). */
    segmentsLite?: Array<{
      start: number;
      end: number;
      speaker: string | null;
      speakerName: string | null;
      text: string;
    }>;
    pipelineSnapshot?: PipelineSnapshot;
  } | null>(null);

  const title = getLocalized(event.title, locale);
  const description = getLocalized(event.description, locale);

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);

  const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);

  const isEnded = event.status === 'ENDED';
  // Evento non concluso che non accetta più iscrizioni: l'orario di fine è
  // passato senza che la sala si aprisse, e la chiusura la farà il giro del
  // ciclo di vita. Per il pubblico è già finito: niente iscrizione, niente
  // ingresso, niente promemoria di calendario.
  const pastEndNotHeld = !isEnded && !registrationOpen;
  // Per il pubblico il warm-up È "in programma": badge e colori non hanno
  // (né devono avere) varianti PROVISIONING/IDLE in 24 lingue.
  const publicStatus = pastEndNotHeld
    ? 'ENDED'
    : ['PROVISIONING', 'IDLE'].includes(event.status)
      ? 'PUBLISHED'
      : event.status;
  const youtubeLink = youtubeWatchLink(event.youtubeUrl);
  const isLive = event.status === 'LIVE';

  // Fetch postprod transcript metadata. Skip se l'evento non è ended
  // o non ha ne' il video ne' la sola trascrizione pubblicati.
  // L'endpoint 404 quando postprod non è abilitato per l'evento; in
  // quel caso lasciamo lo state null e il player gira "nudo".
  useEffect(() => {
    if (!isEnded || (!event.recordingUrl && !event.transcriptPublished)) return;
    let cancelled = false;
    fetch(`/api/events/${event.slug}/postprod/transcript`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) return null;
        const data = (await r.json()) as {
          recordingId: string;
          sourceLanguage: string;
          subtitleTracks: string[];
          summaries: Record<string, string>;
          summariesStructured?: Record<string, StructuredSummary>;
          dubbedAudio?: Array<{ language: string; src: string }>;
          segments?: Array<{
            start: number;
            end: number;
            speaker: string | null;
            speakerName: string | null;
            text: string;
          }>;
          pipelineSnapshot?: PipelineSnapshot;
        };
        const subtitles: SubtitleTrack[] = (data.subtitleTracks ?? []).map((lang) => ({
          language: lang,
          src: `/api/events/${event.slug}/postprod/subtitle/${lang}`,
          label: localeDisplayName(lang),
          isDefault: lang === data.sourceLanguage,
        }));
        const audio: AudioTrack[] = (data.dubbedAudio ?? []).map((d) => ({
          language: d.language,
          src: d.src,
          label: `${localeDisplayName(d.language)} (AI)`,
          isSynthetic: true,
        }));
        const segmentsLite = (data.segments ?? []).map((s) => ({
          start: s.start,
          end: s.end,
          speaker: s.speaker,
          speakerName: s.speakerName,
          text: s.text,
        }));
        return {
          subtitles,
          audio,
          sourceLang: data.sourceLanguage,
          summariesStructured: data.summariesStructured,
          segmentsLite,
          pipelineSnapshot: data.pipelineSnapshot,
        };
      })
      .then((meta) => {
        if (cancelled || !meta) return;
        setPostprodMeta({
          subtitleTracks: meta.subtitles.length > 0 ? meta.subtitles : undefined,
          audioTracks: meta.audio.length > 0 ? meta.audio : undefined,
          // Anche la sola trascrizione, senza sottotitoli del video (quella
          // dai sottotitoli live di un evento senza registrazione).
          transcriptAvailable:
            meta.subtitles.length > 0 || meta.audio.length > 0 || meta.segmentsLite.length > 0,
          summariesStructured:
            meta.summariesStructured && Object.keys(meta.summariesStructured).length > 0
              ? meta.summariesStructured
              : undefined,
          segmentsLite: meta.segmentsLite.length > 0 ? meta.segmentsLite : undefined,
          pipelineSnapshot:
            meta.pipelineSnapshot && Object.keys(meta.pipelineSnapshot).length > 0
              ? meta.pipelineSnapshot
              : undefined,
        });
        setActiveTranscriptLanguage(meta.sourceLang);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isEnded, event.recordingUrl, event.transcriptPublished, event.slug]);

  return (
    <div className="container py-5">
      <div className="mb-4">
        <Link
          href="/events"
          className="text-decoration-none d-inline-flex align-items-center text-primary"
        >
          <Icon icon="it-arrow-left" size="sm" className="me-1" />
          {t('detail.backToEvents')}
        </Link>
      </div>

      {invalidToken && (
        <Alert color="warning" className="mb-4">
          <strong>{t('detail.invalidTokenTitle')}</strong>
          <div className="mt-1">
            {isEnded
              ? t('detail.invalidTokenBodyEnded')
              : pastEndNotHeld
                ? t('detail.registrationEnded')
                : t('detail.invalidTokenBody')}
          </div>
        </Alert>
      )}

      {isEnded && (
        // Un'informazione, non un allarme: l'Alert del kit impone
        // role="alert", che la farebbe leggere d'urgenza all'apertura della
        // pagina. Stesso aspetto, ruolo giusto.
        <div className="alert alert-info mb-4" role="status">
          {t('detail.eventHeldOn', {
            date: format.dateTime(startsAt, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </div>
      )}

      <EventHeader
        title={title}
        parseTitleKicker={parseTitleKicker}
        imageUrl={event.imageUrl}
        tags={tags}
        startsAt={startsAt}
        endsAt={endsAt}
        publicStatus={publicStatus}
        isLive={isLive}
        speakers={speakers && !event.people?.some((p) => p.role === 'speaker') ? speakers : null}
        organizerName={event.organizerName && !(event.organizers && event.organizers.length > 0) ? event.organizerName : null}
      />

      <EventPeople organizers={event.organizers ?? []} people={event.people ?? []} />

      {/* ─── Content + Sidebar ─── */}
      <Row>
        <Col lg={8} className="mb-4 mb-lg-0">
          {/* Hero post-evento: renderizzata solo se la pipeline AI ha
              prodotto un SUMMARY_JSON strutturato. Card prominente con
              sintesi + topic-chip-navigator che fa seek al punto del
              video. Quando manca (postprod non attivato o ancora in
              corso), niente UI — il visitatore vede comunque il video
              e la trascrizione nel tab sotto. */}
          {isEnded && postprodMeta?.summariesStructured && (
            <PostEventHero
              structured={postprodMeta.summariesStructured}
              preferredLocale={locale}
              playerRef={playerRef}
              eventSlug={event.slug}
              pipelineSnapshot={postprodMeta.pipelineSnapshot ?? null}
            />
          )}

          {/* Video di un evento concluso. La registrazione pubblicata passa
              dal player del portale (/api/events/[slug]/recording). Il
              `youtubeUrl` è solo un link esterno, mai un player incorporato:
              un iframe di YouTube farebbe contattare un servizio terzo a
              chiunque apra la pagina (lib/utils/youtube-link). */}
          {isEnded && youtubeLink && (
            <div className="mb-4">
              <a
                href={youtubeLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-decoration-none d-inline-flex align-items-center gap-1 fw-semibold"
              >
                <Icon icon="it-external-link" size="sm" color="primary" />
                {tv('watchOnYouTube')}
              </a>
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                {tv('externalSiteNote')}
              </div>
            </div>
          )}
          {isEnded && event.recordingUrl && (
            <div className="mb-4">
              <div ref={playerAnchorRef} id="event-video" style={{ position: 'relative' }}>
                <VideoPlayer
                  ref={playerRef}
                  src={`/api/events/${event.slug}/recording`}
                  title={title}
                  poster={event.imageUrl ?? undefined}
                  subtitleTracks={postprodMeta?.subtitleTracks}
                  audioTracks={postprodMeta?.audioTracks}
                  onSubtitleChange={(lang) => setActiveTranscriptLanguage(lang)}
                />
                {postprodMeta?.segmentsLite && (
                  <NowSpeakingChip
                    playerRef={playerRef}
                    segments={postprodMeta.segmentsLite}
                  />
                )}
              </div>
              <VideoMiniPlayer
                playerRef={playerRef}
                anchorRef={playerAnchorRef}
                title={title}
                poster={event.imageUrl}
              />

              {/* Mini-transcript inline sotto al video: 3 righe
                  (precedente / attiva / successiva) seguono il
                  playhead in tempo reale. L'utente vede chi parla e
                  cosa dice senza dover scrollare al transcript
                  completo (che resta disponibile nelle tab più sotto). */}
              {postprodMeta?.segmentsLite && (
                <MiniTranscript
                  playerRef={playerRef}
                  segments={postprodMeta.segmentsLite}
                />
              )}

              {/* Scoperibilità del doppiaggio: nota sobria sotto al video
                  che indica al visitatore dove cliccare per cambiare
                  audio. Renderizzata solo se ci sono tracce doppiate. */}
              {postprodMeta?.audioTracks && postprodMeta.audioTracks.length > 0 && (
                <div
                  className="d-flex align-items-start gap-2 mb-3"
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--app-muted)',
                    background: '#f7faff',
                    border: '1px solid #d6e3f1',
                    borderRadius: 8,
                    padding: '8px 12px',
                  }}
                >
                  <Icon icon="it-hearing" size="sm" color={undefined} />
                  <span>
                    {tPostprod('dubAvailableHint', {
                      langs: postprodMeta.audioTracks
                        .map((a) => locName(a.language, locale))
                        .join(', '),
                    })}
                  </span>
                </div>
              )}

              <div className="mt-2">
                <a
                  href={`/api/events/${event.slug}/recording`}
                  download
                  className="text-primary text-decoration-none d-inline-flex align-items-center gap-1"
                  style={{ fontSize: '0.9rem' }}
                >
                  <Icon icon="it-download" size="sm" />
                  {tv('download')}
                </a>
              </div>
            </div>
          )}
          {/* // TODO v0.5.0: Live catch-up player with HLS */}

          {/* Il resoconto dell'evento, pubblicato dallo staff: dopo il video,
              prima della descrizione. */}
          {isEnded && report && (
            <PostEventReport report={report} playerRef={playerRef} hasVideo={!!event.recordingUrl} />
          )}

          <h2 className="h4 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('detail.description')}
          </h2>
          <MarkdownRenderer content={description} className="mb-4" />

          {/* Materiali prima dell'inizio: il server manda qui solo quelli che
              il pubblico può vedere in questa fase (sempre visibili e
              preparatori), e nessuno da quando l'evento è iniziato. A evento
              concluso l'elenco sta nelle tab post-evento. */}
          {!isEnded && materials.length > 0 && (
            <section className="mb-4">
              <h2 className="h4 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
                {tm('title')}
              </h2>
              <MaterialList materials={materials} eventSlug={event.slug} />
            </section>
          )}

          {/* Post-event recap: aggregate summary card above the detail tabs. */}
          {isEnded &&
            event.postEventShowRecap !== false &&
            recap &&
            !isRecapEmpty(recap) && (
              <PostEventRecap
                recap={recap}
                className="mb-4"
                // Words move to the standalone section below whenever it's on,
                // so the recap card must not repeat them.
                hideWords={event.postEventShowWordCloud !== false}
              />
            )}

          {/* Standalone word cloud: surfaces the collective words gated by its
              own toggle, so it can be shown even when the recap card is off (or
              hidden while the recap stays on). Reads the persisted recap words. */}
          {isEnded &&
            event.postEventShowWordCloud !== false &&
            recap &&
            recap.topWords.length > 0 && (
              <Card className="shadow-sm border-0 mb-4">
                <CardBody className="p-4">
                  <h2
                    className="h5 fw-semibold mb-3"
                    style={{ color: 'var(--app-text)' }}
                  >
                    {t('wordCloudTitle')}
                  </h2>
                  <div className="d-flex flex-wrap gap-2">
                    {(() => {
                      const maxCount = Math.max(1, ...recap.topWords.map((x) => x.count));
                      return recap.topWords.map((w, i) => {
                        const size = 0.9 + (w.count / maxCount) * 0.8;
                        return (
                          <span
                            key={i}
                            className="px-2 py-1 rounded bg-white"
                            style={{
                              border: '1px solid #dee5ec',
                              fontSize: `${size}rem`,
                              color: 'var(--app-primary)',
                            }}
                          >
                            {w.word}
                            <span
                              className="text-secondary"
                              style={{ fontSize: '0.7rem' }}
                            >
                              {' '}
                              ·{w.count}
                            </span>
                          </span>
                        );
                      });
                    })()}
                  </div>
                </CardBody>
              </Card>
            )}

          {/* Post-event tabbed content */}
          {isEnded && (
            <PostEventTabs
              questions={answeredQuestions}
              materials={materials}
              polls={polls}
              feedback={feedbackSummary}
              showQA={event.postEventShowQA !== false}
              showMaterials={event.postEventShowMaterials !== false}
              showPolls={event.postEventShowPolls !== false}
              showFeedback={event.postEventShowFeedback !== false}
              eventSlug={event.slug}
              playerRef={playerRef}
              transcriptLanguage={activeTranscriptLanguage}
              transcriptAvailable={postprodMeta?.transcriptAvailable ?? false}
            />
          )}

          {/* Invito al questionario post-evento: solo se l'evento ne ha uno e
              solo a chi ha partecipato, con la sua iscrizione (lo dice il
              server): a chiunque altro il modulo verrebbe rifiutato all'invio. */}
          {isEnded &&
            event.postEventShowFeedback !== false &&
            hasPostEventQuestionnaire &&
            feedbackProof && (
              <PostEventFeedbackInvite
                eventSlug={event.slug}
                accessToken={feedbackProof.accessToken}
                ratingToken={feedbackProof.ratingToken}
              />
            )}

          {/* Feature diagram moved behind the admin UI — it's internal
              infra/capacity info, not something public attendees need. */}
        </Col>

        {/* Al telefono l'iscrizione (o l'ingresso) viene subito dopo il
            titolo: in fondo alla descrizione non la trova nessuno. A evento
            concluso (o finito senza essersi tenuto) conta prima il contenuto. */}
        <Col lg={4} className={isEnded || pastEndNotHeld ? undefined : 'order-first order-lg-0 mb-4 mb-lg-0'}>
          <Card
            className="shadow-sm border-0 sticky-top"
            style={{ top: '1.5rem', borderRadius: '0.75rem' }}
          >
            <CardBody className="p-4">
              {isEnded ? (
                <PostEventSidebar
                  event={event}
                  feedbackSummary={feedbackSummary}
                />
              ) : pastEndNotHeld ? (
                // Iscrizione e ingresso porterebbero a una pagina che risponde
                // 404 (iscrizione) o a una sala che non si apre più.
                <div role="status">
                  <h3
                    className="h6 text-uppercase fw-semibold mb-2"
                    style={{
                      letterSpacing: '0.04em',
                      color: 'var(--app-muted)',
                      fontSize: '0.8rem',
                    }}
                  >
                    {t('detail.eventEnded')}
                  </h3>
                  <p className="text-muted mb-0" style={{ fontSize: '0.88rem' }}>
                    {t('detail.registrationEnded')}
                  </p>
                </div>
              ) : (
                <>
                  {/* Il numero di registrati NON è mostrato
                      pubblicamente (né qui né nel listing). Resta visibile
                      agli amministratori nel pannello admin. Il pubblico vede
                      solo il conteggio dei presenti nella sala live. */}
                  {hasRoomAccess && !invalidToken && (
                    <p
                      className="text-success fw-semibold d-flex align-items-center justify-content-center gap-2 mb-3"
                      role="status"
                    >
                      <Icon icon="it-check-circle" size="sm" color="success" />
                      {t('detail.registered')}
                    </p>
                  )}
                  {/* Da qui in giù l'evento accetta iscrizioni (registrationOpen):
                      gli altri casi li coprono i due rami sopra. */}
                  {!(hasRoomAccess && !invalidToken) &&
                    registrationAccess !== 'closed' && (
                    <Link href={percorso(`/events/${event.slug}/registration`)}>
                      <Button
                        color="primary"
                        size="lg"
                        className="w-100 fw-semibold"
                        tag="span"
                      >
                        <Icon icon="it-user" className="me-2" />
                        {isLive ? t('detail.registerAndJoin') : t('detail.register')}
                      </Button>
                    </Link>
                  )}

                  {/* Iscrizione pubblica spenta: si dice prima del clic chi può
                      iscriversi, o che non si può. Senza il pulsante, chi si
                      era iscritto prima trova qui la via per farsi rimandare
                      il link: la pagina d'iscrizione, che senza invitati
                      offre solo quella. */}
                  {!(hasRoomAccess && !invalidToken) &&
                    registrationAccess !== 'open' && (
                    <p className="text-muted mt-2 mb-0" style={{ fontSize: '0.85rem' }}>
                      {registrationAccess === 'invitation' ? tr('invitationOnly') : tr('closed')}
                    </p>
                  )}
                  {!(hasRoomAccess && !invalidToken) &&
                    registrationAccess === 'closed' && (
                    <p className="mt-2 mb-0" style={{ fontSize: '0.85rem' }}>
                      <Link
                        href={percorso(`/events/${event.slug}/registration`)}
                        className="text-decoration-none fw-semibold text-primary"
                      >
                        {tr('lostLink')}
                      </Link>
                    </p>
                  )}

                  {((isLive && guestEntryOpen) || (hasRoomAccess && !invalidToken)) && (
                    // Via d'ingresso per chi si è già registrato: /live lo
                    // re-identifica dal cookie firmato (o lo fa entrare come
                    // ospite se LIVE e l'amministrazione ammette ospiti),
                    // evitando il loop registrazione → 409. Senza cookie e
                    // senza ospiti /live rimanderebbe all'iscrizione: il link
                    // non compare.
                    // Su evento non ancora LIVE il link appare SOLO se il device
                    // ha il cookie firmato valido: senza, /live rimbalzerebbe alla
                    // registrazione — esattamente il dead-end che questo link vuole
                    // evitare. Con invalidToken (cookie valido ma registrazione
                    // rimossa) /live ci ha appena rimbalzato qui: rimostrare il
                    // link accanto all'alert creerebbe un ping-pong infinito.
                    // Chi ha gia' il posto (cookie firmato) vede il pulsante
                    // pieno «Entra nella sala»; il link a domanda resta per chi
                    // si e' iscritto da un altro dispositivo e qui non e' noto.
                    hasRoomAccess && !invalidToken ? (
                      <Link
                        href={percorso(`/events/${event.slug}/live`)}
                        onMouseDown={svegliaPonte}
                      >
                        <Button color="primary" size="lg" className="w-100 fw-semibold" tag="span">
                          <Icon icon="it-video" color="white" className="me-2" />
                          {tl('enterRoom')}
                        </Button>
                      </Link>
                    ) : (
                      // In diretta si entra anche senza iscrizione: lo si
                      // offre come scelta, non come domanda a chi e' iscritto.
                      // /live riconosce chi ha gia' il posto da questo
                      // dispositivo; chi si e' iscritto da un altro usa il
                      // link dell'email.
                      <>
                        <Link
                          href={percorso(`/events/${event.slug}/live`)}
                          onMouseDown={svegliaPonte}
                          className="d-block mt-2"
                        >
                          <Button color="primary" outline size="lg" className="w-100 fw-semibold" tag="span">
                            {t('detail.joinAsGuest')}
                          </Button>
                        </Link>
                        <p className="text-muted text-center mt-2 mb-0" style={{ fontSize: '0.82rem' }}>
                          {t('detail.registeredUseEmailLink')}
                        </p>
                      </>
                    )
                  )}

                  {event.recordingEnabled && (
                    <p className="text-muted mt-3 mb-0 d-flex align-items-start gap-1" style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                      <Icon icon="it-video" size="xs" className="flex-shrink-0" style={{ marginTop: 1 }} />
                      <span>{t('detail.willBeRecorded')}</span>
                    </p>
                  )}
                  {event.chatEnabled && (
                    <p className="text-muted mt-3 mb-0 d-flex align-items-start gap-1" style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                      <Icon icon="it-info-circle" size="xs" className="flex-shrink-0" style={{ marginTop: 1 }} />
                      <span>{t('detail.chatNotSaved')}</span>
                    </p>
                  )}

                  <AddToCalendar
                    title={title}
                    description={description}
                    startsAt={event.startsAt}
                    endsAt={event.endsAt}
                    slug={event.slug}
                    appUrl={appUrl}
                  />
                </>
              )}
            </CardBody>
          </Card>

          {/* Bookmarks personali del visitatore (localStorage), sotto
              alla card info evento. La card scompare quando la lista
              è vuota: niente UI vuota a sprecare spazio. */}
          {isEnded && <BookmarksPanel slug={event.slug} playerRef={playerRef} />}
        </Col>
      </Row>
    </div>
  );
}

function PostEventSidebar({
  event,
  feedbackSummary,
}: {
  event: EventData;
  feedbackSummary?: FeedbackSummary | null;
}) {
  const t = useTranslations('events');
  const tp = useTranslations('postEvent');
  const format = useFormatter();

  const retentionExpiry = event.dataRetentionDays
    ? new Date(new Date(event.endsAt).getTime() + event.dataRetentionDays * 86_400_000)
    : null;

  return (
    <>
      <h3
        className="h6 text-uppercase fw-semibold mb-3"
        style={{ letterSpacing: '0.04em', color: 'var(--app-muted)', fontSize: '0.8rem' }}
      >
        {t('detail.eventEnded')}
      </h3>

      {/* Registrati non mostrati pubblicamente. Manteniamo solo il
          conteggio dei presenti (picco) qui sotto. */}
      {event.peakParticipants !== undefined && event.peakParticipants > 0 && (
        <div
          className="d-flex align-items-center text-muted mb-2"
          style={{ fontSize: '0.88rem' }}
        >
          <Icon icon="it-chart-line" size="sm" className="me-2" />
          <span>{t('detail.peakParticipants', { count: event.peakParticipants })}</span>
        </div>
      )}

      {feedbackSummary && feedbackSummary.count > 0 && feedbackSummary.average && (
        <div
          className="d-flex align-items-center text-muted mb-2"
          style={{ fontSize: '0.88rem' }}
        >
          <span className="me-2">⭐</span>
          <span>
            {feedbackSummary.average.toFixed(1)}/5 ({feedbackSummary.count})
          </span>
        </div>
      )}

      {event.recordingUrl ? (
        <div
          className="mb-3 d-flex align-items-center gap-2"
          style={{
            fontSize: '0.88rem',
            padding: '8px 12px',
            borderLeft: '3px solid #008758',
            background: '#E6F4EA',
            borderRadius: '0 4px 4px 0',
            color: '#155724',
          }}
        >
          <Icon icon="it-video" size="sm" />
          <span className="fw-semibold">{t('detail.recording')}</span>
        </div>
      ) : (
        <p className="text-muted text-center mb-3" style={{ fontSize: '0.85rem' }}>
          {t('detail.noRecording')}
        </p>
      )}

      {retentionExpiry && (
        <div
          className="mb-0"
          style={{
            fontSize: '0.78rem',
            padding: '8px 12px',
            borderLeft: '3px solid #5c9ec8',
            background: '#E8F0FE',
            borderRadius: '0 4px 4px 0',
            color: 'var(--app-text)',
          }}
        >
          {tp('availableUntil', {
            date: format.dateTime(retentionExpiry, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </div>
      )}
    </>
  );
}
