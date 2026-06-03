import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import RecordingsDashboard from '@/components/admin/recordings-dashboard';

export const dynamic = 'force-dynamic';

export default async function RecordingsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.recordingsLibrary');

  // Event list for the filter dropdown — same pattern as /admin/registrations.
  const events = await prisma.event.findMany({
    where: { status: { not: 'DRAFT' } },
    orderBy: { startsAt: 'desc' },
    take: 200,
    select: { id: true, slug: true, title: true, startsAt: true, eventType: true },
  });

  const eventOptions = events.map((e) => ({
    id: e.id,
    slug: e.slug,
    title: getLocalized(e.title as LocalizedField, locale),
    startsAt: e.startsAt.toISOString(),
    eventType: e.eventType,
  }));

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <RecordingsDashboard events={eventOptions} locale={locale} />
    </div>
  );
}
