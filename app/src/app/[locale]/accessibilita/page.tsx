import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { getSettings } from '@/lib/settings';
import LegalDocumentPage from '@/components/layout/legal-document-page';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface AccessibilityPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: AccessibilityPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.accessibility' });

  return {
    title: t('metaTitle'),
  };
}

export default async function AccessibilityPage() {
  const t = await getTranslations('legal.accessibility');
  const locale = await getLocale();
  const settings = await getSettings();

  const dbContent = getLocalized(settings.accessibility as LocalizedField, locale);

  if (dbContent) {
    return (
      <LegalDocumentPage
        title={t('title')}
        htmlContent={dbContent}
      />
    );
  }

  return (
    <LegalDocumentPage
      title={t('title')}
      intro={t('intro')}
      sections={[
        {
          title: t('sections.commitment.title'),
          body: t('sections.commitment.body'),
        },
        {
          title: t('sections.status.title'),
          body: t('sections.status.body'),
        },
        {
          title: t('sections.feedback.title'),
          body: t('sections.feedback.body'),
        },
      ]}
    />
  );
}
