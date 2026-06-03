import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

import VideoLibraryClient from '@/components/public/video-library-client';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('videoLibrary');
  return {
    title: t('title'),
    description: t('subtitle'),
  };
}

export default async function VideoLibraryPage() {
  const t = await getTranslations('videoLibrary');
  const locale = await getLocale();

  return (
    <div className="container py-5">
      <header className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </header>

      <VideoLibraryClient locale={locale} />
    </div>
  );
}
