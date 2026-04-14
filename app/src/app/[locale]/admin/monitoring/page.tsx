import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import MonitoringDashboard from '@/components/admin/monitoring-dashboard';

export default async function MonitoringPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());

  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.monitoring');

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="text-secondary mb-4">{t('subtitle')}</p>
      <MonitoringDashboard />
    </div>
  );
}
