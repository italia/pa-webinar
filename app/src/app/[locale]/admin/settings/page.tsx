import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { getSettings } from '@/lib/settings';
import SiteSettingsForm from '@/components/admin/site-settings-form';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/settings');
}

export default async function SettingsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.settings');
  const settings = await getSettings();

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/settings')} subtitle={t('subtitle')} />

      <SiteSettingsForm initialSettings={settings} />
    </div>
  );
}
