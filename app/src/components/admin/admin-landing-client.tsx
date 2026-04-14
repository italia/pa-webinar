'use client';

import { useTranslations } from 'next-intl';
import { Card, CardBody, Icon } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface AdminLandingClientProps {
  upcomingCount: number;
  liveCount: number;
}

export default function AdminLandingClient({
  upcomingCount,
  liveCount,
}: AdminLandingClientProps) {
  const t = useTranslations('admin.landing');

  return (
    <div className="row g-4">
      <div className="col-12 col-md-6">
        <Link href="/admin/events" className="text-decoration-none">
          <Card
            className="h-100 border shadow-sm"
            style={{ borderRadius: 12, transition: 'box-shadow 0.2s' }}
            onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
              e.currentTarget.style.boxShadow =
                '0 4px 24px rgba(0,102,204,0.15)';
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
                  }}
                >
                  <Icon icon="it-calendar" size="lg" color="primary" />
                </div>
                <div>
                  <h2
                    className="h4 mb-0 fw-bold"
                    style={{ color: '#17324D' }}
                  >
                    {t('eventsTitle')}
                  </h2>
                </div>
              </div>
              <p className="text-secondary mb-3">{t('eventsDescription')}</p>
              <div className="d-flex gap-3">
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
                  <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                    {t('upcomingEvents', { count: upcomingCount })}
                  </span>
                )}
              </div>
            </CardBody>
          </Card>
        </Link>
      </div>

      <div className="col-12 col-md-6">
        <Link href="/admin/settings" className="text-decoration-none">
          <Card
            className="h-100 border shadow-sm"
            style={{ borderRadius: 12, transition: 'box-shadow 0.2s' }}
            onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
              e.currentTarget.style.boxShadow =
                '0 4px 24px rgba(0,102,204,0.15)';
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
                  }}
                >
                  <Icon icon="it-settings" size="lg" color="primary" />
                </div>
                <div>
                  <h2
                    className="h4 mb-0 fw-bold"
                    style={{ color: '#17324D' }}
                  >
                    {t('settingsTitle')}
                  </h2>
                </div>
              </div>
              <p className="text-secondary mb-3">
                {t('settingsDescription')}
              </p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  );
}
