'use client';

import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Card,
  CardBody,
  CardText,
  CardReadMore,
  Badge,
  Row,
  Col,
  Icon,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import EventTitle from '@/components/events/event-title';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';

interface EventTag {
  slug: string;
  name: Record<string, string>;
  color: string | null;
}

interface EventItem {
  id: string;
  slug: string;
  title: Record<string, string>;
  description: Record<string, string> | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxParticipants: number;
  registrationCount: number;
  status: string;
  recordingUrl: string | null;
  speakersInfo?: Record<string, string> | null;
  organizerName?: string | null;
  imageUrl?: string | null;
  /** Per-event override for the kicker parse. Null = inherit site default. */
  parseTitleKicker?: boolean | null;
  tags?: EventTag[];
}

interface EventListClientProps {
  events: EventItem[];
  muted?: boolean;
  /** Site-wide default for the kicker parse, used when an event has no override. */
  parseTitleKicker?: boolean;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const normalized =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (normalized.length !== 6) return hex;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function EventListClient({
  events,
  muted = false,
  parseTitleKicker = false,
}: EventListClientProps) {
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations('events');

  return (
    <Row className="g-4">
      {events.map((event) => {
        const title = getLocalized(event.title, locale);
        const desc = getLocalized(event.description as LocalizedField, locale);
        const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);
        const isLive = event.status === 'LIVE';
        const isEnded = event.status === 'ENDED';

        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);

        const borderColor = isLive
          ? '#008758'
          : isEnded
            ? '#5A768A'
            : 'var(--app-primary)';

        const eventTags = event.tags ?? [];
        const visibleTags = eventTags.slice(0, 3);
        const overflowCount = Math.max(0, eventTags.length - 3);

        return (
          <Col key={event.id} xs={12} md={6} lg={4}>
            <Card
              className={`event-card h-100 mb-0${muted ? ' opacity-75' : ''}`}
              style={{
                borderTop: `4px solid ${borderColor}`,
                borderRadius: 8,
                border: `1px solid #e8e8e8`,
                borderTopWidth: 4,
                borderTopColor: borderColor,
              }}
            >
              <CardBody className="d-flex flex-column p-4">
                <div className="mb-3">
                  <Badge color="primary" className="me-2">
                    {t('card.publicEvent')}
                  </Badge>
                  {isLive && (
                    <Badge color="success" className="d-inline-flex align-items-center gap-1">
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
                  {isEnded && muted && (
                    <Badge color="secondary">{t('card.ended')}</Badge>
                  )}
                </div>

                <EventTitle
                  title={title}
                  kickerEnabled={resolveKickerEnabled(event, parseTitleKicker)}
                  as="h3"
                  className="h5 fw-semibold mb-2"
                  style={{ color: 'var(--app-text)' }}
                  wrapMain={(main) => (
                    <Link
                      href={`/events/${event.slug}`}
                      className="text-decoration-none"
                      style={{ color: 'var(--app-text)' }}
                    >
                      {main}
                    </Link>
                  )}
                />

                {visibleTags.length > 0 && (
                  <div className="d-flex flex-wrap gap-1 mb-2">
                    {visibleTags.map((tag) => {
                      const displayName =
                        tag.name[locale] ??
                        tag.name.it ??
                        tag.name.en ??
                        tag.slug;
                      const color = tag.color ?? '#0066CC';
                      return (
                        <Link
                          key={tag.slug}
                          href={{ pathname: '/events', query: { tag: tag.slug } }}
                          className="badge text-decoration-none"
                          style={{
                            backgroundColor: hexWithAlpha(color, 0.15),
                            color,
                            fontWeight: 500,
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: 12,
                          }}
                        >
                          {displayName}
                        </Link>
                      );
                    })}
                    {overflowCount > 0 && (
                      <span
                        className="badge"
                        style={{
                          backgroundColor: '#F5F7FB',
                          color: 'var(--app-muted)',
                          fontSize: '0.72rem',
                          padding: '3px 8px',
                          borderRadius: 12,
                        }}
                      >
                        +{overflowCount}
                      </span>
                    )}
                  </div>
                )}

                <div className="d-flex align-items-center text-secondary mb-2">
                  <Icon icon="it-calendar" size="sm" className="me-2 flex-shrink-0" />
                  <small>
                    {format.dateTime(startsAt, {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                    {' · '}
                    {format.dateTime(startsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' – '}
                    {format.dateTime(endsAt, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </div>

                {speakers && (
                  <div className="d-flex align-items-center text-secondary mb-2">
                    <Icon icon="it-user" size="sm" className="me-2 flex-shrink-0" />
                    <small className="text-truncate">{speakers}</small>
                  </div>
                )}

                {desc && (
                  <CardText
                    className="text-secondary mb-3 small"
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {desc}
                  </CardText>
                )}

                <div
                  className="d-flex justify-content-between align-items-center mt-auto pt-3"
                  style={{ borderTop: '1px solid #e8e8e8' }}
                >
                  {isEnded ? (
                    event.recordingUrl ? (
                      <Badge color="success" pill>
                        <Icon icon="it-video" size="xs" className="me-1" />
                        {t('detail.recording')}
                      </Badge>
                    ) : event.registrationCount > 0 ? (
                      <span className="text-muted small">
                        {t('card.registeredCount', { count: event.registrationCount })}
                      </span>
                    ) : null
                  ) : (
                    <Badge color="secondary" pill>
                      <Icon icon="it-user" size="xs" className="me-1" />
                      {t('card.registeredCount', { count: event.registrationCount })}
                    </Badge>
                  )}
                  <CardReadMore
                    tag={Link}
                    href={`/events/${event.slug}`}
                    text={t('card.readMore')}
                    iconName="it-arrow-right"
                  />
                </div>
              </CardBody>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
