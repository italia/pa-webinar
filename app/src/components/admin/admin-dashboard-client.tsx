'use client';

import { useTranslations, useLocale, useFormatter } from 'next-intl';
import {
  Card,
  CardBody,
  CardTitle,
  CardText,
  Row,
  Col,
  Icon,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';

import StatusBadge from './status-badge';

interface EventSummary {
  id: string;
  titleIt: string;
  titleEn: string | null;
  slug: string;
  startsAt: string;
  endsAt: string;
  status: string;
  registrationCount: number;
  maxParticipants: number;
  moderatorToken: string;
}

interface AdminDashboardClientProps {
  events: EventSummary[];
  token?: string;
}

export default function AdminDashboardClient({
  events,
  token,
}: AdminDashboardClientProps) {
  const locale = useLocale();
  const format = useFormatter();
  const t = useTranslations('admin');

  return (
    <Row>
      {events.map((event) => {
        const title =
          locale === 'en' && event.titleEn ? event.titleEn : event.titleIt;
        const startsAt = new Date(event.startsAt);

        return (
          <Col key={event.id} sm={12} md={6} lg={4} className="mb-4">
            <Card teaser className="card-bg rounded shadow-sm h-100">
              <CardBody>
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <StatusBadge status={event.status} />
                </div>
                <CardTitle tag="h5" className="mb-2">
                  <Link
                    href={`/admin/eventi/${event.id}?token=${token ?? event.moderatorToken}`}
                    className="text-decoration-none"
                  >
                    {title}
                  </Link>
                </CardTitle>
                <CardText tag="div">
                  <div className="d-flex align-items-center text-muted mb-1">
                    <Icon icon="it-calendar" size="sm" className="me-2" />
                    <small>
                      {format.dateTime(startsAt, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </small>
                  </div>
                  <div className="d-flex align-items-center text-muted">
                    <Icon icon="it-user" size="sm" className="me-2" />
                    <small>
                      {t('registrationCount', {
                        count: event.registrationCount,
                      })}{' '}
                      / {event.maxParticipants}
                    </small>
                  </div>
                </CardText>
              </CardBody>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
