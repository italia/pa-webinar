import { getTranslations, getLocale } from 'next-intl/server';

import { getSettings } from '@/lib/settings';

export default async function AccessibilityPage() {
  const t = await getTranslations('pages');
  const locale = await getLocale();
  const settings = await getSettings();

  const content =
    locale === 'en' ? settings.accessibilityEn : settings.accessibilityIt;

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h1 className="fw-bold mb-4">{t('accessibilityTitle')}</h1>
          {content ? (
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : (
            <div
              className="p-4 rounded-3 text-center"
              style={{ backgroundColor: '#F5F7FB' }}
            >
              <p className="text-secondary mb-0">
                {t('accessibilityNotConfigured')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
