import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import GdprTemplatesManagement from '@/components/admin/gdpr-templates-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/settings/gdpr-templates');
}

export default async function GdprTemplatesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.gdprTemplates');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/settings/gdpr-templates')} subtitle={t('subtitle')} />
      <GdprTemplatesManagement />
    </div>
  );
}
