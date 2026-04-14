import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { Link } from '@/i18n/navigation';
import { Badge, Card, CardBody, Icon } from 'design-react-kit';

export const dynamic = 'force-dynamic';

function formatDuration(seconds: number | null): string {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSize(bytes: bigint | null): string {
  if (!bytes) return '—';
  const n = Number(bytes);
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export default async function InstantCallsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) redirect(`/${locale}/admin/login`);

  const t = await getTranslations('admin.instantCalls');

  const calls = await prisma.event.findMany({
    where: { eventType: 'INSTANT' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      createdAt: true,
      moderatorName: true,
      moderatorToken: true,
      peakParticipants: true,
      recordingUrl: true,
      recordingDuration: true,
      recordingFileSize: true,
      _count: { select: { callSessions: true, registrations: true } },
    },
    take: 100,
  });

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="mb-1">{t('title')}</h1>
          <p className="text-secondary mb-0">{t('subtitle')}</p>
        </div>
        <span className="badge bg-primary rounded-pill px-3 py-2" style={{ fontSize: '0.9rem' }}>
          {calls.length} {t('total')}
        </span>
      </div>

      {calls.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardBody className="p-5 text-center">
            <Icon icon="it-video" size="xl" className="text-muted mb-3" />
            <p className="text-muted">{t('noCalls')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="d-flex flex-column gap-3">
          {calls.map((call) => {
            const title = getLocalized(call.title as LocalizedField, locale);
            const isLive = call.status === 'LIVE';
            const hasRecording = !!call.recordingUrl;

            return (
              <Link
                key={call.id}
                href={`/admin/events/${call.id}?token=${call.moderatorToken}`}
                className="text-decoration-none"
              >
                <Card className="border-0 shadow-sm" style={{ borderRadius: 8, transition: 'box-shadow 0.15s' }}>
                  <CardBody className="p-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center gap-2 mb-1">
                          <Icon icon="it-video" size="sm" className="text-primary" />
                          <span className="fw-semibold" style={{ color: '#17324D' }}>{title}</span>
                          {isLive && (
                            <Badge color="danger" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
                              LIVE
                            </Badge>
                          )}
                          {hasRecording && (
                            <Badge color="success" pill className="px-2 py-1" style={{ fontSize: '0.7rem' }}>
                              <Icon icon="it-video" size="xs" className="me-1" />
                              REC
                            </Badge>
                          )}
                        </div>
                        <div className="d-flex gap-3 text-muted" style={{ fontSize: '0.82rem' }}>
                          {call.moderatorName && (
                            <span>
                              <Icon icon="it-user" size="xs" className="me-1" />
                              {call.moderatorName}
                            </span>
                          )}
                          <span>
                            <Icon icon="it-calendar" size="xs" className="me-1" />
                            {new Date(call.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>
                            <Icon icon="it-team-digitale" size="xs" className="me-1" />
                            {call.peakParticipants} {t('participants')}
                          </span>
                          {call.recordingDuration && (
                            <span>
                              <Icon icon="it-clock" size="xs" className="me-1" />
                              {formatDuration(call.recordingDuration)}
                            </span>
                          )}
                          {call.recordingFileSize && (
                            <span>{formatSize(call.recordingFileSize)}</span>
                          )}
                          {call._count.callSessions > 0 && (
                            <span>{call._count.callSessions} {t('sessions')}</span>
                          )}
                        </div>
                      </div>
                      <Icon icon="it-arrow-right" size="sm" className="text-muted mt-1" />
                    </div>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
