import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { staffOLogin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import { localizedPath } from '@/lib/utils/localized-url';
import AdminLandingClient from '@/components/admin/admin-landing-client';

interface AdminPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('admin');

  if (token) {
    redirect(localizedPath(`/admin/events?token=${token}`, await getLocale()));
  }

  // L'indice mostra i numeri di tutta l'istanza: per chi organizza i propri
  // eventi la pagina di partenza e' l'elenco di quelli (ADR-014).
  const locale = await getLocale();
  const session = await staffOLogin(locale);
  if (session.role !== 'admin') redirect(localizedPath('/admin/events', locale));

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const last30d = new Date(now.getTime() - 30 * 86400_000);

  const [
    upcomingCount,
    liveCount,
    instantCallsLast30d,
    registrationsTotal,
    registrationsToday,
    recordingsTotal,
  ] = await Promise.all([
    prisma.event.count({
      where: { status: 'PUBLISHED', startsAt: { gt: now } },
    }),
    prisma.event.count({ where: { status: 'LIVE' } }),
    prisma.event.count({
      where: { eventType: 'INSTANT', createdAt: { gte: last30d } },
    }),
    prisma.registration.count(),
    prisma.registration.count({ where: { createdAt: { gte: todayStart } } }),
    // Count both per-event published recordings and per-session artifacts
    // from CallSession. We deliberately don't de-duplicate since the
    // "library" view merges the two sources and a single count "reflecting
    // what the admin will see" is what the card needs.
    (async () => {
      const [a, b] = await Promise.all([
        prisma.event.count({ where: { recordingUrl: { not: null } } }),
        prisma.callSession.count({ where: { recordingUrl: { not: null } } }),
      ]);
      return a + b;
    })(),
  ]);

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-start mb-5 flex-wrap gap-3">
        <div>
          <h1 className="mb-1 fw-bold" style={{ color: 'var(--app-text)' }}>
            {t('landing.title')}
          </h1>
          <p className="text-secondary mb-0">{t('landing.subtitle')}</p>
        </div>
      </div>

      <AdminLandingClient
        upcomingCount={upcomingCount}
        liveCount={liveCount}
        instantCallsLast30d={instantCallsLast30d}
        registrationsTotal={registrationsTotal}
        registrationsToday={registrationsToday}
        recordingsTotal={recordingsTotal}
      />
    </div>
  );
}
