import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { getPublicEnv } from '@/lib/env';
import ModeratorsDashboard from '@/components/admin/moderators-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/moderators');
}

export default async function ModeratorsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.moderators');
  const appUrl = getPublicEnv('NEXT_PUBLIC_APP_URL') ?? '';

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/moderators')} subtitle={t('subtitle')} />
      <ModeratorsDashboard appUrl={appUrl} locale={locale} />
    </div>
  );
}
