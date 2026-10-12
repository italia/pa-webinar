import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import GdprAuditDashboard from '@/components/admin/gdpr-audit-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/gdpr-audit');
}

export default async function GdprAuditPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.gdprAudit');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/gdpr-audit')} subtitle={t('subtitle')} />
      <GdprAuditDashboard />
    </div>
  );
}
