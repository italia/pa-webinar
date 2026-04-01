'use client';

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
import AddToCalendar from '@/components/events/add-to-calendar';
import PostEventQA from '@/components/events/post-event-qa';

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
  titleIt: string;
  titleEn: string | null;
  descriptionIt: string;
  descriptionEn: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  status: string;
  recordingUrl: string | null;
  qaEnabled: boolean;
  chatEnabled: boolean;
  privacyPolicyUrl: string | null;
  speakersIt: string | null;
  speakersEn: string | null;
  organizerName: string | null;
  imageUrl: string | null;
}

interface MaterialData {
  id: string;
  title: string;
  url: string;
  description: string | null;
  addedBy: string;
  createdAt: string;
}

interface EventDetailClientProps {
  event: EventData;
  locale: string;
  answeredQuestions?: AnsweredQuestion[];
  materials?: MaterialData[];
}

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: '#0066CC',
  LIVE: '#008758',
  ENDED: '#5A768A',
};

export default function EventDetailClient({
  event,
  locale,
  answeredQuestions = [],
  materials = [],
}: EventDetailClientProps) {
  const t = useTranslations('events');
  const tm = useTranslations('materials');
  const format = useFormatter();

  const title =
    locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
  const description =
    locale === 'en' && event.descriptionEn
      ? event.descriptionEn
      : event.descriptionIt;

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const durationMs = endsAt.getTime() - startsAt.getTime();
  const durationHours = Math.floor(durationMs / 3_600_000);
  const durationMinutes = Math.floor((durationMs % 3_600_000) / 60_000);

  const speakers =
    locale === 'en' && event.speakersEn
      ? event.speakersEn
      : (event.speakersIt ?? '');

  const spotsLeft = event.maxParticipants - event.registrationCount;
  const isFull = spotsLeft <= 0;
  const canRegister = (event.status === 'PUBLISHED' || event.status === 'LIVE') && !isFull;
  const isEnded = event.status === 'ENDED';
  const isLive = event.status === 'LIVE';
  const accentColor = STATUS_COLOR[event.status] ?? STATUS_COLOR.PUBLISHED;
  const occupancyPct = Math.min(
    100,
    (event.registrationCount / event.maxParticipants) * 100,
  );

  return (
    <div className="container py-5">
      <div className="mb-4">
        <Link
          href="/eventi"
          className="text-decoration-none d-inline-flex align-items-center text-primary"
        >
          <Icon icon="it-arrow-left" size="sm" className="me-1" />
          {t('detail.backToEvents')}
        </Link>
      </div>

      {isEnded && (
        <Alert color="info" className="mb-4">
          <Icon icon="it-info-circle" className="me-2" />
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

        <h1 className="mb-4" style={{ color: '#17324D', lineHeight: 1.3 }}>
          {title}
        </h1>

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
          <h2 className="h4 fw-semibold mb-3" style={{ color: '#17324D' }}>
            {t('detail.description')}
          </h2>
          <div
            className="mb-4 text-secondary"
            style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '1.05rem' }}
          >
            {description}
          </div>

          {isEnded && event.qaEnabled && answeredQuestions.length > 0 && (
            <div className="mt-4">
              <h2 className="h4 fw-semibold mb-3" style={{ color: '#17324D' }}>
                <Icon icon="it-comment" className="me-2" />
                {t('detail.qaPostEvent')}
              </h2>
              <PostEventQA questions={answeredQuestions} />
            </div>
          )}

          {isEnded && materials.length > 0 && (
            <div className="mt-4">
              <h2 className="h4 fw-semibold mb-3" style={{ color: '#17324D' }}>
                <Icon icon="it-files" className="me-2" />
                {tm('postEventTitle')}
              </h2>
              <div className="d-flex flex-column gap-2">
                {materials.map((m) => (
                  <Card key={m.id} className="shadow-sm border-0" style={{ borderRadius: '0.5rem' }}>
                    <CardBody className="p-3">
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="fw-semibold text-primary text-decoration-none d-inline-flex align-items-center gap-1"
                      >
                        <Icon icon="it-external-link" size="sm" />
                        {m.title}
                      </a>
                      {m.description && (
                        <p className="text-muted mb-1 mt-1" style={{ fontSize: '0.9rem' }}>
                          {m.description}
                        </p>
                      )}
                      <div className="text-muted" style={{ fontSize: '0.8rem' }}>
                        {tm('addedBy', { name: m.addedBy })}
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          )}
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
                    <span className="fw-normal text-muted" style={{ fontSize: '1rem' }}>
                      {' / '}
                      {event.maxParticipants}
                    </span>
                  </div>

                  <div className="text-muted small mb-3">
                    {t('detail.occupiedSpots', {
                      registered: event.registrationCount,
                      max: event.maxParticipants,
                    })}
                  </div>

                  <div
                    className="progress mb-4"
                    style={{ height: '6px', borderRadius: '3px' }}
                  >
                    <div
                      className="progress-bar"
                      role="progressbar"
                      style={{
                        width: `${occupancyPct}%`,
                        backgroundColor: isFull ? '#D9364E' : accentColor,
                        borderRadius: '3px',
                      }}
                      aria-valuenow={event.registrationCount}
                      aria-valuemin={0}
                      aria-valuemax={event.maxParticipants}
                    />
                  </div>

                  {isFull && (
                    <div className="text-center mb-3">
                      <Badge color="danger" className="px-3 py-2">
                        {t('detail.full')}
                      </Badge>
                    </div>
                  )}

                  {canRegister && (
                    <Link href={`/eventi/${event.slug}/registrazione`}>
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
}: {
  event: EventData;
  registrationCount: number;
}) {
  const t = useTranslations('events');

  return (
    <>
      <h3
        className="h6 text-uppercase fw-semibold mb-3"
        style={{ letterSpacing: '0.04em', color: '#5A768A', fontSize: '0.8rem' }}
      >
        {t('detail.eventEnded')}
      </h3>

      <div className="d-flex align-items-center text-muted mb-3">
        <Icon icon="it-user" size="sm" className="me-2" />
        <span>{t('detail.totalRegistrations', { count: registrationCount })}</span>
      </div>

      {event.recordingUrl ? (
        <>
          <Alert color="success" className="mb-3 py-2 px-3">
            <div className="d-flex align-items-center">
              <Icon icon="it-video" className="me-2" />
              <span className="fw-semibold">{t('detail.recording')}</span>
            </div>
          </Alert>
          <a
            href={event.recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button color="primary" size="lg" className="w-100 fw-semibold" tag="span">
              <Icon icon="it-video" className="me-2" />
              {t('detail.watchRecording')}
            </Button>
          </a>
        </>
      ) : (
        <p className="text-muted text-center mb-0">
          {t('detail.noRecording')}
        </p>
      )}
    </>
  );
}
