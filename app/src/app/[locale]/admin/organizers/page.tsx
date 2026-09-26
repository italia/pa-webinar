import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import OrganizersManagement from '@/components/admin/organizers-management';

export const dynamic = 'force-dynamic';

export default async function OrganizersPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;
  const t = await getTranslations('admin.organizers');

  return (
    <div className="container py-5">
      <h1 className="mb-1">{t('title')}</h1>
      <p className="text-secondary mb-4" style={{ maxWidth: 720 }}>
        {t('intro')}
      </p>
      <OrganizersManagement />
    </div>
  );
}
