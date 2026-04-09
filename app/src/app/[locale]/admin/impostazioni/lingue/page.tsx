import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getSettings } from '@/lib/settings';
import LanguageManagement from '@/components/admin/language-management';

export default async function LanguagesPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.languages');
  const settings = await getSettings();

  const config = {
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
      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <LanguageManagement initialConfig={config} />
    </div>
  );
}
