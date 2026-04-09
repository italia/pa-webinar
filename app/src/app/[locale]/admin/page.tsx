import { getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';

import { prisma } from '@/lib/db';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import AdminLogoutButton from '@/components/admin/admin-logout-button';
import AdminLandingClient from '@/components/admin/admin-landing-client';

interface AdminPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { token } = await searchParams;
  const t = await getTranslations('admin');
  const isAdmin = await isAdminAuthenticated(await cookies());

  if (token) {
    const { redirect } = await import('next/navigation');
    redirect(`/admin/eventi?token=${token}`);
  }

  const [upcomingCount, liveCount] = await Promise.all([
    prisma.event.count({
      where: { status: 'PUBLISHED', startsAt: { gt: new Date() } },
    }),
    prisma.event.count({ where: { status: 'LIVE' } }),
  ]);

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-start mb-5 flex-wrap gap-3">
        <div>
          <h1 className="mb-1 fw-bold" style={{ color: '#17324D' }}>
            {t('landing.title')}
          </h1>
          <p className="text-secondary mb-0">{t('landing.subtitle')}</p>
        </div>
        {isAdmin && (
          <div className="d-flex gap-2 align-items-center flex-shrink-0">
            <AdminLogoutButton />
          </div>
        )}
      </div>

      <AdminLandingClient
        upcomingCount={upcomingCount}
        liveCount={liveCount}
      />
    </div>
  );
}
