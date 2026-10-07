import { getTranslations, getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { eventScope } from '@/lib/auth/staff-session';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import RecordingsDashboard from '@/components/admin/recordings-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/recordings');
}

export default async function RecordingsPage() {
  const locale = await getLocale();
  const session = await staffOLogin(locale);

  const t = await getTranslations('admin.recordingsLibrary');

  // Event list for the filter dropdown — same pattern as /admin/registrations.
  const events = await prisma.event.findMany({
    where: { status: { not: 'DRAFT' }, ...eventScope(session) },
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
      <AdminPageHeader title={await adminPageTitle('/admin/recordings')} subtitle={t('subtitle')} />
      <RecordingsDashboard
        events={eventOptions}
        locale={locale}
        canManageStorage={session.role === 'admin'}
      />
    </div>
  );
}
