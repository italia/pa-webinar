'use client';

import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Card,
  CardBody,
  CardTitle,
  CardText,
  CardReadMore,
  Badge,
  Row,
  Col,
  Icon,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

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
}

interface EventListClientProps {
  events: EventItem[];
  muted?: boolean;
}

export default function EventListClient({
  events,
  muted = false,
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
        const spotsLeft = event.maxParticipants - event.registrationCount;
        const isFull = spotsLeft <= 0;
        const isLive = event.status === 'LIVE';
        const isEnded = event.status === 'ENDED';

        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);

        const borderColor = isLive
          ? '#008758'
          : isEnded
            ? '#5A768A'
            : '#0066CC';

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

                <CardTitle tag="h3" className="h5 fw-semibold mb-2">
                  <Link
                    href={`/eventi/${event.slug}`}
                    className="text-decoration-none"
                    style={{ color: '#17324D' }}
                  >
                    {title}
                  </Link>
                </CardTitle>

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
                    ) : (
                      <span className="text-muted small">
                        {t('card.occupiedSpots', {
                          registered: event.registrationCount,
                          max: event.maxParticipants,
                        })}
                      </span>
                    )
                  ) : (
                    <Badge color={isFull ? 'danger' : 'secondary'} pill>
                      <Icon icon="it-user" size="xs" className="me-1" />
                      {isFull
                        ? t('card.fullyBooked')
                        : t('card.spotsAvailable', { count: spotsLeft })}
                    </Badge>
                  )}
                  <CardReadMore
                    tag={Link}
                    href={`/eventi/${event.slug}`}
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
