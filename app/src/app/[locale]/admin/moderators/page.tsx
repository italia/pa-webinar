import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getPublicEnv } from '@/lib/env';
import ModeratorsDashboard from '@/components/admin/moderators-dashboard';

export const dynamic = 'force-dynamic';

export default async function ModeratorsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.moderators');
  const appUrl = getPublicEnv('NEXT_PUBLIC_APP_URL') ?? '';

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <ModeratorsDashboard appUrl={appUrl} locale={locale} />
    </div>
  );
}
