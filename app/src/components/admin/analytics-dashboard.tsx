'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Card,
  CardBody,
  Col,
  Icon,
  Row,
  Spinner,
  Table,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';

type Period = '7d' | '30d' | '90d' | 'all';

interface OverviewData {
  totalEvents: number;
  totalRegistrations: number;
  totalParticipants: number;
  totalQuestions: number;
  totalPollVotes: number;
  averageParticipantsPerEvent: number;
  averageConversionRate: number;
  averageDurationMinutes: number;
  averageFeedbackRating: number;
  totalFeedback: number;
}

interface TimelineEntry {
  date: string;
  events: number;
  registrations: number;
  participants: number;
}

interface EventAnalytics {
  eventId: string;
  title: string;
  date: string;
  registrations: number;
  participants: number;
  peakParticipants: number;
  questions: number;
  pollVotes: number;
  durationMinutes: number;
  conversionRate: number;
}

interface AnalyticsResponse {
  overview: OverviewData;
  timeline: TimelineEntry[];
  topEvents: EventAnalytics[];
  recentEvents: EventAnalytics[];
}

export default function AnalyticsDashboard() {
  const t = useTranslations('admin.analytics');
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/analytics?period=${p}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(period);
  }, [period, fetchData]);

  if (loading && !data) {
    return (
      <div className="text-center py-5">
        <Spinner active />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* Period selector */}
      <div className="d-flex gap-2 mb-4">
        {(['7d', '30d', '90d', 'all'] as const).map((p) => (
          <button
            key={p}
            className={`btn btn-sm ${period === p ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => setPeriod(p)}
          >
            {t(`period.${p}`)}
          </button>
        ))}
        {loading && <Spinner active small className="ms-2" />}
      </div>

      {/* Overview cards */}
      <OverviewCards overview={data.overview} />

      {/* Timeline chart */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-4">{t('timeline')}</h5>
          <TimelineChart data={data.timeline} />
        </CardBody>
      </Card>

      {/* Top events table */}
      <Card className="border-0 shadow-sm mb-4">
        <CardBody className="p-4">
          <h5 className="fw-semibold mb-4">{t('topEvents')}</h5>
          <EventsTable events={data.topEvents} />
        </CardBody>
      </Card>

      {/* Quick stats */}
      <QuickStats overview={data.overview} />
    </div>
  );
}

function OverviewCards({ overview }: { overview: OverviewData }) {
  const t = useTranslations('admin.analytics.metrics');

  const cards = [
    {
      value: overview.totalEvents,
      label: t('totalEvents'),
      icon: 'it-calendar',
      color: '#0066CC',
    },
    {
      value: overview.totalRegistrations,
      label: t('totalRegistrations'),
      icon: 'it-mail',
      color: '#008758',
    },
    {
      value: overview.totalParticipants,
      label: t('totalParticipants'),
      icon: 'it-user',
      color: '#A66300',
    },
    {
      value: `${overview.averageConversionRate}%`,
      label: t('conversionRate'),
      icon: 'it-chart-line',
      color: '#7B2D8E',
    },
  ];

  return (
    <Row className="mb-4">
      {cards.map((card) => (
        <Col key={card.label} sm={6} lg={3} className="mb-3">
          <Card
            className="border-0 h-100"
            style={{
              borderTop: `4px solid ${card.color}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              borderRadius: 8,
            }}
          >
            <CardBody className="p-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <Icon icon={card.icon} size="sm" style={{ color: card.color }} />
                <span
                  className="text-secondary"
                  style={{ fontSize: '0.82rem' }}
                >
                  {card.label}
                </span>
              </div>
              <div
                className="fw-bold"
                style={{ fontSize: '1.8rem', color: '#17324D' }}
              >
                {card.value}
              </div>
            </CardBody>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function TimelineChart({ data }: { data: TimelineEntry[] }) {
  const t = useTranslations('admin.analytics');

  if (data.length === 0) {
    return (
      <p className="text-muted text-center py-4">{t('noData')}</p>
    );
  }

  const maxValue = Math.max(
    ...data.map((d) => Math.max(d.registrations, d.participants)),
    1,
  );

  const displayData =
    data.length > 60 ? data.filter((_, i) => i % Math.ceil(data.length / 60) === 0) : data;

  return (
    <div>
      <div className="d-flex gap-4 mb-3">
        <span className="d-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
          <span
            className="d-inline-block rounded"
            style={{ width: 12, height: 12, backgroundColor: '#0066CC' }}
          />
          {t('metrics.totalRegistrations')}
        </span>
        <span className="d-flex align-items-center gap-1" style={{ fontSize: '0.8rem' }}>
          <span
            className="d-inline-block rounded"
            style={{ width: 12, height: 12, backgroundColor: '#008758' }}
          />
          {t('metrics.totalParticipants')}
        </span>
      </div>
      <div
        className="d-flex align-items-end gap-1"
        style={{ height: 200, overflowX: 'auto' }}
      >
        {displayData.map((d, i) => (
          <div
            key={i}
            className="flex-fill text-center"
            style={{ minWidth: 16, maxWidth: 30 }}
          >
            <div className="d-flex align-items-end justify-content-center gap-0" style={{ height: 180 }}>
              <div
                style={{
                  width: '45%',
                  height: `${Math.max((d.registrations / maxValue) * 100, 1)}%`,
                  backgroundColor: '#0066CC',
                  borderRadius: '2px 2px 0 0',
                  minHeight: 2,
                }}
                title={`${d.date}: ${d.registrations} reg.`}
              />
              <div
                style={{
                  width: '45%',
                  height: `${Math.max((d.participants / maxValue) * 100, 1)}%`,
                  backgroundColor: '#008758',
                  borderRadius: '2px 2px 0 0',
                  minHeight: 2,
                }}
                title={`${d.date}: ${d.participants} part.`}
              />
            </div>
            {(i === 0 ||
              i === displayData.length - 1 ||
              i % Math.max(Math.ceil(displayData.length / 7), 1) === 0) && (
              <small
                className="text-secondary d-block"
                style={{ fontSize: '0.6rem', whiteSpace: 'nowrap' }}
              >
                {d.date.slice(5)}
              </small>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventsTable({ events }: { events: EventAnalytics[] }) {
  const t = useTranslations('admin.analytics.table');
  const format = useFormatter();

  if (events.length === 0) {
    return <p className="text-muted text-center py-3">{t('noEvents')}</p>;
  }

  return (
    <div className="table-responsive">
      <Table hover className="mb-0">
        <thead>
          <tr>
            <th>{t('event')}</th>
            <th className="text-center">{t('date')}</th>
            <th className="text-center">{t('registrations')}</th>
            <th className="text-center">{t('participants')}</th>
            <th className="text-center">{t('peak')}</th>
            <th className="text-center">{t('questions')}</th>
            <th className="text-center">{t('conversion')}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.eventId}>
              <td>
                <Link
                  href={`/admin/eventi/${event.eventId}`}
                  className="text-decoration-none fw-semibold"
                  style={{ color: '#0066CC' }}
                >
                  {event.title}
                </Link>
              </td>
              <td className="text-center text-nowrap" style={{ fontSize: '0.88rem' }}>
                {format.dateTime(new Date(event.date), {
                  day: 'numeric',
                  month: 'short',
                  year: '2-digit',
                })}
              </td>
              <td className="text-center">{event.registrations}</td>
              <td className="text-center">{event.participants}</td>
              <td className="text-center">{event.peakParticipants}</td>
              <td className="text-center">{event.questions}</td>
              <td className="text-center">
                <span
                  className="badge"
                  style={{
                    backgroundColor:
                      event.conversionRate >= 70
                        ? '#008758'
                        : event.conversionRate >= 40
                          ? '#A66300'
                          : '#D9364F',
                    color: '#fff',
                    fontSize: '0.78rem',
                  }}
                >
                  {event.conversionRate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function QuickStats({ overview }: { overview: OverviewData }) {
  const t = useTranslations('admin.analytics.quickStats');

  const hours = Math.floor(overview.averageDurationMinutes / 60);
  const minutes = overview.averageDurationMinutes % 60;

  const stats = [
    {
      label: t('avgDuration'),
      value:
        hours > 0 ? `${hours}h ${minutes}min` : `${minutes}min`,
    },
    {
      label: t('avgQuestionsPerEvent'),
      value:
        overview.totalEvents > 0
          ? Math.round(
              overview.totalQuestions / overview.totalEvents,
            ).toString()
          : '0',
    },
    {
      label: t('totalPollVotes'),
      value: overview.totalPollVotes.toString(),
    },
    {
      label: t('avgParticipantsPerEvent'),
      value: overview.averageParticipantsPerEvent.toString(),
    },
    ...(overview.totalFeedback > 0 ? [{
      label: t('avgFeedbackRating'),
      value: `${overview.averageFeedbackRating}/5 (${overview.totalFeedback})`,
    }] : []),
  ];

  return (
    <Card className="border-0 shadow-sm">
      <CardBody className="p-4">
        <h5 className="fw-semibold mb-4">{t('title')}</h5>
        <Row>
          {stats.map((stat) => (
            <Col key={stat.label} sm={6} md={3} className="mb-3 mb-md-0">
              <div className="text-center">
                <div
                  className="fw-bold mb-1"
                  style={{ fontSize: '1.4rem', color: '#17324D' }}
                >
                  {stat.value}
                </div>
                <div
                  className="text-secondary"
                  style={{ fontSize: '0.82rem' }}
                >
                  {stat.label}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </CardBody>
    </Card>
  );
}
