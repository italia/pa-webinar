import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import LegalDocumentPage from '@/components/layout/legal-document-page';

interface LegalNotesPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({
  params,
}: LegalNotesPageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.legalNotes' });

  return {
    title: t('metaTitle'),
  };
}

export default async function LegalNotesPage() {
  const t = await getTranslations('legal.legalNotes');

  return (
    <LegalDocumentPage
      title={t('title')}
      intro={t('intro')}
      sections={[
        {
          title: t('sections.ownership.title'),
          body: t('sections.ownership.body'),
        },
        {
          title: t('sections.usage.title'),
          body: t('sections.usage.body'),
        },
        {
          title: t('sections.liability.title'),
          body: t('sections.liability.body'),
        },
      ]}
    />
  );
}
