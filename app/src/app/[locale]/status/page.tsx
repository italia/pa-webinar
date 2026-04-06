import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import StatusDashboard from '@/components/status/status-dashboard';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status');
  return { title: t('title') };
}

export default async function StatusPage() {
  const t = await getTranslations('status');

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="lead text-muted mb-5" style={{ maxWidth: '680px' }}>
        {t('subtitle')}
      </p>
      <StatusDashboard />
    </div>
  );
}
