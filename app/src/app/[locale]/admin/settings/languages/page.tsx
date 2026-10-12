import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { getSettings } from '@/lib/settings';
import LanguageManagement from '@/components/admin/language-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/settings/languages');
}

export default async function LanguagesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.languages');
  const settings = await getSettings();

  const config = {
    defaultLocale: settings.defaultLocale ?? 'it',
    availableLocales: (settings.availableLocales ?? ['it', 'en']) as string[],
    localeNames: (settings.localeNames ?? {
      it: 'Italiano',
      en: 'English',
    }) as Record<string, string>,
    translationOverrides: (settings.translationOverrides ?? {}) as Record<
      string,
      Record<string, string>
    >,
  };

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/settings/languages')} subtitle={t('subtitle')} />
      <LanguageManagement initialConfig={config} />
    </div>
  );
}
