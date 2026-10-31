'use client';

import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Card,
  CardBody,
  CardText,
  Badge,
  Row,
  Col,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link, percorso } from '@/i18n/navigation';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import EventTitle from '@/components/events/event-title';
import { resolveKickerEnabled } from '@/lib/utils/title-kicker';
import { hexWithAlpha, inchiostroEtichetta } from '@/lib/utils/tag-color';

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
  /** La descrizione come testo semplice, preparata sul server (event-list.tsx). */
  descrizioneTesto?: string;
}

export interface EventListClientProps {
  events: EventItem[];
  muted?: boolean;
  /** Site-wide default for the kicker parse, used when an event has no override. */
  parseTitleKicker?: boolean;
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
        // La descrizione e' in Markdown: nella scheda va il testo, non la
        // sintassi. La prepara il server (event-list.tsx), cosi' il lettore
        // Markdown non arriva nel browser.
        const desc = event.descrizioneTesto ?? '';
        const speakers = getLocalized(event.speakersInfo as LocalizedField, locale);
        const isLive = event.status === 'LIVE';
        const isEnded = event.status === 'ENDED';

        const startsAt = new Date(event.startsAt);
        const endsAt = new Date(event.endsAt);

        const borderColor = isLive
          ? '#008758'
          : isEnded
            ? '#516B7E'
            : 'var(--app-primary)';

        const eventTags = event.tags ?? [];
        const visibleTags = eventTags.slice(0, 3);
        const overflowCount = Math.max(0, eventTags.length - 3);

        return (
          <Col key={event.id} xs={12} md={6} lg={4}>
            <Card
              className="event-card h-100 mb-0"
              style={{
                borderTop: `4px solid ${borderColor}`,
                borderRadius: 8,
                border: `1px solid #e8e8e8`,
                borderTopWidth: 4,
                borderTopColor: borderColor,
                overflow: 'hidden',
              }}
            >
              {event.imageUrl && (
                <div
                  style={{
                    aspectRatio: '16 / 9',
                    backgroundImage: `url(${event.imageUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    backgroundColor: '#E8F0FE',
                  }}
                  aria-hidden="true"
                />
              )}
              <CardBody className="d-flex flex-column p-4">
                {/* Solo cio' che distingue la scheda: che l'evento e' pubblico
                    lo dice gia' l'elenco in cui sta. */}
                {(isLive || (isEnded && muted)) && (
                <div className="mb-3">
                  {isLive && (
                    <Badge color="success" className="d-inline-flex align-items-center gap-1">
                      <span
                        className="rounded-circle d-inline-block pulse-dot"
                        style={{
                          width: 7,
                          height: 7,
                          backgroundColor: '#fff',
                        }}
                      />
                      {t('card.liveNow')}
                    </Badge>
                  )}
                  {isEnded && muted && (
                    <Badge color="secondary">{t('card.ended')}</Badge>
                  )}
                </div>
                )}

                <EventTitle
                  title={title}
                  kickerEnabled={resolveKickerEnabled(event, parseTitleKicker)}
                  as="h3"
                  className="h5 fw-semibold mb-2"
                  style={{ color: 'var(--app-text)' }}
                  // Tutta la scheda porta all'evento (il link del titolo si
                  // allarga sulla scheda), come promette il sollevamento al
                  // passaggio del mouse; le etichette restano link loro.
                  wrapMain={(main) => (
                    <Link
                      href={percorso(`/events/${event.slug}`)}
                      className="text-decoration-none stretched-link"
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
                            position: 'relative',
                            zIndex: 2,
                            backgroundColor: hexWithAlpha(color, 0.15),
                            color: inchiostroEtichetta(color, 0.15),
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
                  {/* Il conteggio dei registrati non è esposto
                      pubblicamente sulle card. Manteniamo solo il badge
                      "registrazione disponibile" per gli eventi conclusi. */}
                  {isEnded && event.recordingUrl ? (
                    <Badge color="success" pill>
                      <Icon icon="it-video" size="xs" className="me-1" />
                      {t('detail.recording')}
                    </Badge>
                  ) : (
                    <span />
                  )}
                  {/* Il markup di `CardReadMore`, scritto qui: il componente di
                      design-react-kit passa l'indirizzo senza localizzarlo e
                      disegna la freccia con l'icona che sparisce
                      all'idratazione. */}
                  {/* Doppione del titolo, che porta gia' alla pagina e copre la
                      scheda: per gli occhi, non per la tastiera. */}
                  <Link className="read-more" href={percorso(`/events/${event.slug}`)} tabIndex={-1} aria-hidden="true">
                    <span className="text">{t('card.readMore')}</span>
                    <Icon icon="it-arrow-right" />
                  </Link>
                </div>
              </CardBody>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
