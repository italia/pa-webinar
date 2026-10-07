import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import PublicationsDashboard from '@/components/admin/publications-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/publications');
}

export default async function PublicationsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.publications');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/publications')} subtitle={t('subtitle')} />
      <PublicationsDashboard />
    </div>
  );
}
