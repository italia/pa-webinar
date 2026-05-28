'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Button,
  Badge,
  Card,
  CardBody,
  Icon,
  Row,
  Col,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import AddToCalendar from '@/components/events/add-to-calendar';
import VideoPlayer, {
  type VideoPlayerHandle,
  type SubtitleTrack,
  type AudioTrack,
} from '@/components/events/video-player';
import PostEventTabs from '@/components/events/post-event-tabs';
import PostEventHero, { type StructuredSummary } from '@/components/events/post-event-hero';
import NowSpeakingChip from '@/components/events/now-speaking-chip';
import VideoMiniPlayer from '@/components/events/video-mini-player';
import { useDeepLinkSeek } from '@/lib/utils/use-deep-link';
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
  tags?: TagChip[];
}

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: '#0066CC',
  LIVE: '#008758',
  ENDED: '#5A768A',
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
  tags = [],
}: EventDetailClientProps) {
  const t = useTranslations('events');
  const tv = useTranslations('video');
  const format = useFormatter();

  // Ref del player — usato dal TranscriptPanel per click-to-seek + da
  // future feature live (es. timestamp deeplink ?t=120).
  const playerRef = useRef<VideoPlayerHandle>(null);
  const playerAnchorRef = useRef<HTMLDivElement>(null);
  useDeepLinkSeek(playerRef);
  // Lingua attiva dei sottotitoli — guida quale variante di summary
  // mostrare nel TranscriptPanel ("la sintesi nella lingua che stai
  // guardando").
  const [activeTranscriptLanguage, setActiveTranscriptLanguage] = useState<
    string | null
  >(null);
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
    segmentsLite?: Array<{ start: number; end: number; speaker: string | null; speakerName: string | null }>;
  } | null>(null);

  const title = getLocalized(event.title, locale);
  const description = getLocalized(event.description, locale);

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);

  const canRegister = event.status === 'PUBLISHED' || event.status === 'LIVE';
  const isEnded = event.status === 'ENDED';
  const isLive = event.status === 'LIVE';
  const accentColor = STATUS_COLOR[event.status] ?? STATUS_COLOR.PUBLISHED;

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
          }>;
        };
        const subtitles: SubtitleTrack[] = (data.subtitleTracks ?? []).map(
          (lang) => ({
            language: lang,
            src: `/api/events/${event.slug}/postprod/subtitle/${lang}`,
            label: localeDisplayName(lang),
            isDefault: lang === data.sourceLanguage,
          }),
        );
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
        }));
        return {
          subtitles,
          audio,
          sourceLang: data.sourceLanguage,
          summariesStructured: data.summariesStructured,
          segmentsLite,
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

      {/* ─── Hero section ─── */}
      <div
        className="rounded-3 p-4 p-lg-5 mb-5"
        style={{
          background: 'linear-gradient(135deg, #F5F7FB 0%, #E8F0FE 100%)',
          borderLeft: `5px solid ${accentColor}`,
        }}
      >
        <div className="d-flex align-items-center gap-2 mb-3">
          <StatusPill status={event.status} />
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
          style={{ color: '#17324D', lineHeight: 1.3 }}
        />

        {tags.length > 0 && (
          <div className="d-flex flex-wrap gap-2 mb-4">
            {tags.map((tag) => {
              const label =
                tag.name[locale] ?? tag.name.it ?? tag.name.en ?? tag.slug;
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
                <div className="fw-semibold" style={{ color: '#17324D' }}>
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
                  <div className="fw-semibold" style={{ color: '#17324D' }}>
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
                  <div className="fw-semibold" style={{ color: '#17324D' }}>
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

          <h2 className="h4 fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('detail.description')}
          </h2>
          <MarkdownRenderer content={description} className="mb-4" />

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
                  registrationCount={event.registrationCount}
                  feedbackSummary={feedbackSummary}
                />
              ) : (
                <>
                  <h3
                    className="h6 text-uppercase fw-semibold mb-3"
                    style={{ letterSpacing: '0.04em', color: '#5A768A', fontSize: '0.8rem' }}
                  >
                    {t('detail.participants')}
                  </h3>

                  <div className="mb-2 fw-semibold" style={{ fontSize: '1.5rem', color: '#17324D' }}>
                    {event.registrationCount}
                  </div>
                  <div className="text-muted small mb-4">
                    {t('detail.totalRegistrations', { count: event.registrationCount })}
                  </div>

                  {canRegister && (
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
        </Col>
      </Row>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const t = useTranslations('events.status');
  const colorMap: Record<string, { bg: string; fg: string }> = {
    PUBLISHED: { bg: '#E8F0FE', fg: '#0066CC' },
    LIVE: { bg: '#D4EDDA', fg: '#155724' },
    ENDED: { bg: '#E9ECEF', fg: '#5A768A' },
    DRAFT: { bg: '#FFF3CD', fg: '#856404' },
    ARCHIVED: { bg: '#E9ECEF', fg: '#5A768A' },
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
  registrationCount,
  feedbackSummary,
}: {
  event: EventData;
  registrationCount: number;
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
        style={{ letterSpacing: '0.04em', color: '#5A768A', fontSize: '0.8rem' }}
      >
        {t('detail.eventEnded')}
      </h3>

      <div className="d-flex align-items-center text-muted mb-2" style={{ fontSize: '0.88rem' }}>
        <Icon icon="it-user" size="sm" className="me-2" />
        <span>{t('detail.totalRegistrations', { count: registrationCount })}</span>
      </div>

      {event.peakParticipants !== undefined && event.peakParticipants > 0 && (
        <div className="d-flex align-items-center text-muted mb-2" style={{ fontSize: '0.88rem' }}>
          <Icon icon="it-chart-line" size="sm" className="me-2" />
          <span>{t('detail.peakParticipants', { count: event.peakParticipants })}</span>
        </div>
      )}

      {feedbackSummary && feedbackSummary.count > 0 && feedbackSummary.average && (
        <div className="d-flex align-items-center text-muted mb-2" style={{ fontSize: '0.88rem' }}>
          <span className="me-2">⭐</span>
          <span>{feedbackSummary.average.toFixed(1)}/5 ({feedbackSummary.count})</span>
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
            color: '#17324D',
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
  } catch { /* fall through */ }
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
    <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden', borderRadius: 8, background: '#000' }}>
      <iframe
        src={embed}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
