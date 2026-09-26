import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import RegistrationsDashboard from '@/components/admin/registrations-dashboard';

export const dynamic = 'force-dynamic';

export default async function RegistrationsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.registrations');

  // Event list used by the filter dropdown. Limited to 200 most recent so
  // the select doesn't explode on long-lived instances.
  const events = await prisma.event.findMany({
    where: { status: { not: 'DRAFT' } },
    orderBy: { startsAt: 'desc' },
    take: 200,
    select: { id: true, slug: true, title: true, startsAt: true, status: true },
  });

  const eventOptions = events.map((e) => ({
    id: e.id,
    slug: e.slug,
    title: getLocalized(e.title as LocalizedField, locale),
    startsAt: e.startsAt.toISOString(),
    status: e.status,
  }));

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <RegistrationsDashboard events={eventOptions} locale={locale} />
    </div>
  );
}
