'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Alert, Button, Badge, Card, CardBody, Icon, Row, Col } from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { REGISTRABLE_STATUSES } from '@/lib/events/visibility';
import AddToCalendar from '@/components/events/add-to-calendar';
import VideoPlayer, {
  type VideoPlayerHandle,
  type SubtitleTrack,
  type AudioTrack,
} from '@/components/events/video-player';
import PostEventTabs from '@/components/events/post-event-tabs';
import PostEventRecap from '@/components/events/post-event-recap';
import { isRecapEmpty, type EventRecap } from '@/lib/events/recap';
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
import EventTitle from '@/components/events/event-title';
import { MarkdownRenderer } from '@/components/ui/markdown';

interface AnsweredQuestion {
  id: string;
  text: string;
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

interface TagChip {
  slug: string;
  name: Record<string, string>;
  color: string | null;
}

interface EventDetailClientProps {
  event: EventData;
  locale: string;
  parseTitleKicker?: boolean;
  answeredQuestions?: AnsweredQuestion[];
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
}

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: 'var(--app-primary)',
  LIVE: '#008758',
  ENDED: 'var(--app-muted)',
};

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
  parseTitleKicker = false,
  answeredQuestions = [],
  materials = [],
  polls = [],
  feedbackSummary = null,
  recap = null,
  tags = [],
  invalidToken = false,
  hasRoomAccess = false,
}: EventDetailClientProps) {
  const t = useTranslations('events');
  const tv = useTranslations('video');
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
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);

  // PROVISIONING/IDLE = evento schedulato in pre-warm/pausa: registrazione
  // aperta come per PUBLISHED. Il server ha già applicato i filtri veri
  // (eventType/endsAt, vedi lib/events/visibility): qui basta lo stato.
  const canRegister = (REGISTRABLE_STATUSES as string[]).includes(event.status);
  // Per il pubblico il warm-up È "in programma": badge e colori non hanno
  // (né devono avere) varianti PROVISIONING/IDLE in 24 lingue.
  const publicStatus = ['PROVISIONING', 'IDLE'].includes(event.status)
    ? 'PUBLISHED'
    : event.status;
  const isEnded = event.status === 'ENDED';
  const isLive = event.status === 'LIVE';
  const accentColor = STATUS_COLOR[publicStatus] ?? STATUS_COLOR.PUBLISHED;

  // Fetch postprod transcript metadata. Skip se l'evento non è ended
  // o non ha recording pubblicata — niente trascrizione da mostrare.
  // L'endpoint 404 quando postprod non è abilitato per l'evento; in
  // quel caso lasciamo lo state null e il player gira "nudo".
  useEffect(() => {
    if (!isEnded || !event.recordingUrl) return;
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
          transcriptAvailable: meta.subtitles.length > 0 || meta.audio.length > 0,
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
  }, [isEnded, event.recordingUrl, event.slug]);

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
            {isEnded ? t('detail.invalidTokenBodyEnded') : t('detail.invalidTokenBody')}
          </div>
        </Alert>
      )}

      {isEnded && (
        <Alert color="info" className="mb-4">
          {t('detail.eventHeldOn', {
            date: format.dateTime(startsAt, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })}
        </Alert>
      )}

      {/* ─── Event header: cover + hero in one cohesive card ─── */}
      <div
        className="mb-5 rounded-3 shadow-sm overflow-hidden"
        style={{ border: '1px solid #e3e9f0' }}
      >
        {/* 16:9 cover, cover-filled — same treatment as the event cards and
            video-library thumbnails, so it looks consistent in every view
            regardless of the asset's native ratio. The admin sets coverImageUrl
            and imageUrl to the same asset; imageUrl carries it here (it also
            doubles as the post-event video poster). */}
        {event.imageUrl && (
          <div
            style={{
              width: '100%',
              aspectRatio: '16 / 9',
              // Cap the height so a wide screen can't blow the banner up to
              // ~full-viewport. `contain` keeps a designed cover graphic fully
              // visible (no crop) centred on a soft brand background.
              maxHeight: 'min(38vh, 340px)',
              backgroundImage: `url(${event.imageUrl})`,
              backgroundSize: 'contain',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              backgroundColor: '#E8F0FE',
            }}
            role="img"
            aria-label={title}
          />
        )}

        {/* ─── Hero content ─── */}
        <div
          className="p-4 p-lg-5"
          style={{
            background: 'linear-gradient(135deg, #F5F7FB 0%, #E8F0FE 100%)',
            borderLeft: `5px solid ${accentColor}`,
          }}
        >
          <div className="d-flex align-items-center gap-2 mb-3">
            <StatusPill status={publicStatus} />
            {isLive && (
              <Badge
                color="success"
                className="px-2 py-1 d-inline-flex align-items-center gap-1"
                style={{ fontSize: '0.75rem' }}
              >
                <span
                  className="rounded-circle d-inline-block"
                  style={{
                    width: 7,
                    height: 7,
                    backgroundColor: '#fff',
                    animation: 'pulse-dot 1.5s ease-in-out infinite',
                  }}
                />
                {t('card.liveNow')}
              </Badge>
            )}
          </div>

          <EventTitle
            title={title}
            kickerEnabled={parseTitleKicker}
            as="h1"
            className="mb-3"
            style={{ color: 'var(--app-text)', lineHeight: 1.3 }}
          />

          {tags.length > 0 && (
            <div className="d-flex flex-wrap gap-2 mb-4">
              {tags.map((tag) => {
                const label = tag.name[locale] ?? tag.name.it ?? tag.name.en ?? tag.slug;
                const color = tag.color ?? '#5A768A';
                return (
                  <Link
                    key={tag.slug}
                    href={`/events?tag=${tag.slug}`}
                    className="text-decoration-none"
                    style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: 999,
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      backgroundColor: `${color}22`,
                      color,
                      border: `1px solid ${color}44`,
                    }}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          )}

          <Row className="g-3 g-lg-4">
            <Col xs={12} md="auto">
              <div className="d-flex align-items-center">
                <div
                  className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                  style={{
                    width: 44,
                    height: 44,
                    backgroundColor: 'rgba(0,102,204,0.1)',
                  }}
                >
                  <Icon icon="it-calendar" className="text-primary" />
                </div>
                <div>
                  <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                    {format.dateTime(startsAt, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                    {format.dateTime(startsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' – '}
                    {format.dateTime(endsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {t('detail.durationHours', {
                      hours: durationHours,
                      minutes: durationMinutes,
                    })}
                  </div>
                </div>
              </div>
            </Col>
            {speakers && (
              <Col xs={12} md="auto">
                <div className="d-flex align-items-center">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: 'rgba(0,102,204,0.1)',
                    }}
                  >
                    <Icon icon="it-user" className="text-primary" />
                  </div>
                  <div>
                    <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                      {t('detail.speakers')}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      {speakers}
                    </div>
                  </div>
                </div>
              </Col>
            )}
            {event.organizerName && (
              <Col xs={12} md="auto">
                <div className="d-flex align-items-center">
                  <div
                    className="rounded-circle d-flex align-items-center justify-content-center me-3 flex-shrink-0"
                    style={{
                      width: 44,
                      height: 44,
                      backgroundColor: 'rgba(0,102,204,0.1)',
                    }}
                  >
                    <Icon icon="it-pa" className="text-primary" />
                  </div>
                  <div>
                    <div className="fw-semibold" style={{ color: 'var(--app-text)' }}>
                      {t('detail.organizer')}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      {event.organizerName}
                    </div>
                  </div>
                </div>
              </Col>
            )}
          </Row>
        </div>
      </div>

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

          {/* Video player for ended events with a recording. YouTube
              embed wins when set (legacy uploads / mirrored streams);
              otherwise the self-hosted MP4 is served via our signed
              /api/events/[slug]/recording route. */}
          {isEnded && event.youtubeUrl && (
            <div className="mb-4">
              <YouTubeEmbed url={event.youtubeUrl} title={title} />
            </div>
          )}
          {isEnded && !event.youtubeUrl && event.recordingUrl && (
            <div className="mb-4">
              <div ref={playerAnchorRef} style={{ position: 'relative' }}>
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
                  <Icon icon="it-volume-high" size="sm" color={undefined} />
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

          <h2 className="h4 fw-semibold mb-3" style={{ color: 'var(--app-text)' }}>
            {t('detail.description')}
          </h2>
          <MarkdownRenderer content={description} className="mb-4" />

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

          {/* Post-event feedback questionnaire invite (self-hides when the
              event has no POST_EVENT questionnaire configured). */}
          {isEnded && event.postEventShowFeedback !== false && (
            <PostEventFeedbackInvite eventSlug={event.slug} />
          )}

          {/* Feature diagram moved behind the admin UI — it's internal
              infra/capacity info, not something public attendees need. */}
        </Col>

        <Col lg={4}>
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
              ) : (
                <>
                  {/* F5: il numero di registrati NON è più mostrato
                      pubblicamente (né qui né nel listing). Resta visibile
                      agli amministratori nel pannello admin. Il pubblico vede
                      solo il conteggio dei presenti nella sala live. */}
                  {hasRoomAccess && !invalidToken && (
                    <p className="text-success fw-semibold text-center mb-3" role="status">
                      {t('detail.registered')}
                    </p>
                  )}
                  {canRegister && !(hasRoomAccess && !invalidToken) && (
                    <Link href={`/events/${event.slug}/registration`}>
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

                  {canRegister && (isLive || (hasRoomAccess && !invalidToken)) && (
                    // Via d'ingresso per chi si è già registrato: /live lo
                    // re-identifica dal cookie firmato (o lo fa entrare come
                    // ospite se LIVE), evitando il loop registrazione → 409.
                    // Su evento non ancora LIVE il link appare SOLO se il device
                    // ha il cookie firmato valido: senza, /live rimbalzerebbe alla
                    // registrazione — esattamente il dead-end che questo link vuole
                    // evitare. Con invalidToken (cookie valido ma registrazione
                    // rimossa) /live ci ha appena rimbalzato qui: rimostrare il
                    // link accanto all'alert creerebbe un ping-pong infinito.
                    <p className="text-center mt-3 mb-0" style={{ fontSize: '0.85rem' }}>
                      <Link
                        href={`/events/${event.slug}/live`}
                        className="text-decoration-none fw-semibold text-primary"
                        onMouseDown={() => {
                          // 1a: anticipa il risveglio del bridge (JVB) al
                          // momento del click, prima di navigazione + idratazione
                          // di /live — così il pre-warm parte qualche secondo
                          // prima. L'endpoint wake è idempotente e no-op se
                          // l'evento è già LIVE.
                          void fetch(`/api/events/${event.slug}/wake`, {
                            method: 'POST',
                          }).catch(() => {});
                        }}
                      >
                        {t('detail.alreadyRegisteredEnter')}
                      </Link>
                    </p>
                  )}

                  {event.chatEnabled && (
                    <p className="text-muted mt-3 mb-0" style={{ fontSize: '0.82rem' }}>
                      <Icon icon="it-info-circle" size="xs" className="me-1" />
                      {t('detail.chatNotSaved')}
                    </p>
                  )}

                  <AddToCalendar
                    title={title}
                    description={description}
                    startsAt={event.startsAt}
                    endsAt={event.endsAt}
                    slug={event.slug}
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

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('events.status');
  const colorMap: Record<string, { bg: string; fg: string }> = {
    PUBLISHED: { bg: '#E8F0FE', fg: 'var(--app-primary)' },
    LIVE: { bg: '#D4EDDA', fg: '#155724' },
    ENDED: { bg: '#E9ECEF', fg: 'var(--app-muted)' },
    DRAFT: { bg: '#FFF3CD', fg: '#856404' },
    ARCHIVED: { bg: '#E9ECEF', fg: 'var(--app-muted)' },
  };
  const fallback = { bg: '#FFF3CD', fg: '#856404' };
  const c = colorMap[status] ?? fallback;
  return (
    <Badge
      color=""
      className="px-2 py-1 fw-semibold"
      style={{ fontSize: '0.72rem', backgroundColor: c.bg, color: c.fg }}
    >
      {t(status as 'DRAFT' | 'PUBLISHED' | 'LIVE' | 'ENDED' | 'ARCHIVED')}
    </Badge>
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

      {/* F5: registrati non mostrati pubblicamente. Manteniamo solo il
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

/**
 * Normalize a YouTube watch/shortlink URL to an embed URL.
 * Accepts:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/embed/VIDEO_ID (already normalized)
 * Returns null for anything we can't confidently map to a video id.
 */
function toYouTubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return url;
      const id = u.searchParams.get('v');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const embed = toYouTubeEmbed(url);
  if (!embed) {
    // Fallback to a plain link if the URL didn't parse as a YouTube
    // video — better than rendering nothing silently.
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
  }
  return (
    <div
      style={{
        position: 'relative',
        paddingBottom: '56.25%',
        height: 0,
        overflow: 'hidden',
        borderRadius: 8,
        background: '#000',
      }}
    >
      <iframe
        src={embed}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: 0,
        }}
      />
    </div>
  );
}
