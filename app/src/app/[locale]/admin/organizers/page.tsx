import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import OrganizersManagement from '@/components/admin/organizers-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/organizers');
}

export default async function OrganizersPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;
  const t = await getTranslations('admin.organizers');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/organizers')} subtitle={t('intro')} />
      <OrganizersManagement />
    </div>
  );
}
