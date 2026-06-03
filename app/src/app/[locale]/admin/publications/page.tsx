import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import PublicationsDashboard from '@/components/admin/publications-dashboard';

export const dynamic = 'force-dynamic';

export default async function PublicationsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.publications');

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
            {t('title')}
          </h1>
          <p className="text-secondary mb-0">{t('subtitle')}</p>
        </div>
      </div>
      <PublicationsDashboard locale={locale} />
    </div>
  );
}
