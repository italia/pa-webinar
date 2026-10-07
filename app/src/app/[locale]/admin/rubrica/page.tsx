import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import RubricaList from '@/components/admin/rubrica-list';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/rubrica');
}

export default async function RubricaPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.rubrica');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/rubrica')} subtitle={t('subtitle')} />
      <RubricaList />
    </div>
  );
}
