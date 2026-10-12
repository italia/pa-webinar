import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import AnalyticsDashboard from '@/components/admin/analytics-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/events/statistics');
}

export default async function AnalyticsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.analytics');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/events/statistics')} subtitle={t('subtitle')} />
      <AnalyticsDashboard />
    </div>
  );
}
