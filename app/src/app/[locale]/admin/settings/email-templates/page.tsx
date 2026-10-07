import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import EmailTemplatesManagement from '@/components/admin/email-templates-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/settings/email-templates');
}

export default async function EmailTemplatesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.emailTemplates');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/settings/email-templates')} subtitle={t('subtitle')} />
      <EmailTemplatesManagement />
    </div>
  );
}
