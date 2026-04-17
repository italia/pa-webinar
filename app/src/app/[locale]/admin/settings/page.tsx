import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getSettings } from '@/lib/settings';
import SiteSettingsForm from '@/components/admin/site-settings-form';
import SettingsSectionsGrid from '@/components/admin/settings-sections-grid';

export default async function SettingsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.settings');
  const settings = await getSettings();

  return (
    <div className="container py-5">
      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>

      {/* Surface sub-sections as cards on the settings landing so
          "Languages" and "GDPR templates" are discoverable even without
          relying on the top sub-nav. The sub-nav remains — this is an
          additional, more obvious entry-point. */}
      <SettingsSectionsGrid />

      <SiteSettingsForm initialSettings={settings} />
    </div>
  );
}
