'use client';

import { useTranslations } from 'next-intl';
import { Card, CardBody, Icon } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface AdminLandingClientProps {
  upcomingCount: number;
  liveCount: number;
  instantCallsLast30d: number;
  registrationsTotal: number;
  registrationsToday: number;
  recordingsTotal: number;
}

/**
 * Card rendered as a Link. Hover shadow effect inlined here so we don't
 * need a separate CSS module for a 2-line style.
 */
function AdminCard({
  href,
  icon,
  title,
  description,
  children,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="text-decoration-none">
      <Card
        className="h-100 border shadow-sm"
        style={{ borderRadius: 12, transition: 'box-shadow 0.2s' }}
        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.boxShadow = '0 4px 24px rgba(0,102,204,0.15)';
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
          e.currentTarget.style.boxShadow = '';
        }}
      >
        <CardBody className="p-4">
          <div className="d-flex align-items-center gap-3 mb-3">
            <div
              className="d-flex align-items-center justify-content-center rounded-3"
              style={{
                width: 56,
                height: 56,
                backgroundColor: 'rgba(0,102,204,0.1)',
                flexShrink: 0,
              }}
            >
              <Icon icon={icon} size="lg" color="primary" />
            </div>
            <div>
              <h2 className="h5 mb-0 fw-bold" style={{ color: '#17324D' }}>
                {title}
              </h2>
            </div>
          </div>
          <p className="text-secondary mb-3" style={{ fontSize: '0.88rem' }}>
            {description}
          </p>
          {children}
        </CardBody>
      </Card>
    </Link>
  );
}

export default function AdminLandingClient({
  upcomingCount,
  liveCount,
  instantCallsLast30d,
  registrationsTotal,
  registrationsToday,
  recordingsTotal,
}: AdminLandingClientProps) {
  const t = useTranslations('admin.landing');

  return (
    <div className="row g-4">
      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/events"
          icon="it-calendar"
          title={t('eventsTitle')}
          description={t('eventsDescription')}
        >
          <div className="d-flex gap-2 flex-wrap">
            {liveCount > 0 && (
              <span className="badge bg-danger d-inline-flex align-items-center gap-1 px-2 py-1">
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#fff',
                    display: 'inline-block',
                  }}
                />
                {t('liveNow', { count: liveCount })}
              </span>
            )}
            {upcomingCount > 0 && (
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                {t('upcomingEvents', { count: upcomingCount })}
              </span>
            )}
          </div>
        </AdminCard>
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/events/calls"
          icon="it-video"
          title={t('instantCallsTitle')}
          description={t('instantCallsDescription')}
        >
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>
            {t('instantCallsStat', { count: instantCallsLast30d })}
          </span>
        </AdminCard>
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/registrations"
          icon="it-user"
          title={t('registrationsTitle')}
          description={t('registrationsDescription')}
        >
          <div className="d-flex gap-3 flex-wrap" style={{ fontSize: '0.82rem' }}>
            <span className="text-muted">
              {t('registrationsTotal', { count: registrationsTotal })}
            </span>
            {registrationsToday > 0 && (
              <span className="badge bg-success">
                +{registrationsToday} {t('today')}
              </span>
            )}
          </div>
        </AdminCard>
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/recordings"
          icon="it-video"
          title={t('recordingsTitle')}
          description={t('recordingsDescription')}
        >
          <span className="text-muted" style={{ fontSize: '0.82rem' }}>
            {t('recordingsStat', { count: recordingsTotal })}
          </span>
        </AdminCard>
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/events/statistics"
          icon="it-chart-line"
          title={t('analyticsTitle')}
          description={t('analyticsDescription')}
        />
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/monitoring"
          icon="it-presentation"
          title={t('monitoringTitle')}
          description={t('monitoringDescription')}
        />
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/events/template"
          icon="it-copy"
          title={t('templatesTitle')}
          description={t('templatesDescription')}
        />
      </div>

      <div className="col-12 col-md-6 col-lg-4">
        <AdminCard
          href="/admin/settings"
          icon="it-settings"
          title={t('settingsTitle')}
          description={t('settingsDescription')}
        />
      </div>
    </div>
  );
}
