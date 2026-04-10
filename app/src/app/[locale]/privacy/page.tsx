import type { Metadata } from 'next';
import { getTranslations, getLocale } from 'next-intl/server';

import { getSettings } from '@/lib/settings';
import LegalDocumentPage from '@/components/layout/legal-document-page';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';

interface PrivacyPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: PrivacyPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.privacy' });

  return {
    title: t('metaTitle'),
  };
}

export default async function PrivacyPage() {
  const t = await getTranslations('legal.privacy');
  const locale = await getLocale();
  const settings = await getSettings();

  const dbContent = getLocalized(settings.privacyPolicy as LocalizedField, locale);

  if (dbContent) {
    return (
      <LegalDocumentPage
        title={t('title')}
        htmlContent={dbContent}
        noteTitle={t('note.title')}
        noteBody={t('note.body')}
        noteLink={{ href: '/privacy/i-miei-dati', label: t('note.linkLabel') }}
      />
    );
  }

  return (
    <LegalDocumentPage
      title={t('title')}
      intro={t('intro')}
      sections={[
        {
          title: t('sections.controller.title'),
          body: t('sections.controller.body'),
        },
        {
          title: t('sections.data.title'),
          body: t('sections.data.body'),
        },
        {
          title: t('sections.retention.title'),
          body: t('sections.retention.body'),
        },
      ]}
      noteTitle={t('note.title')}
      noteBody={t('note.body')}
      noteLink={{ href: '/privacy/i-miei-dati', label: t('note.linkLabel') }}
    />
  );
}
