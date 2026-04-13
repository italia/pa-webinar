import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import StatusDashboard from '@/components/status/status-dashboard';
import InfrastructureMap from '@/components/status/infrastructure-map';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('status');
  return { title: t('title') };
}

export default async function StatusPage() {
  const t = await getTranslations('status');
  const tMap = await getTranslations('infraMap');

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="lead text-muted mb-4" style={{ maxWidth: '680px' }}>
        {t('subtitle')}
      </p>

      <section className="mb-5">
        <h2 className="h4 fw-semibold mb-3">{tMap('title')}</h2>
        <p className="text-muted mb-3" style={{ fontSize: '0.88rem' }}>
          {tMap('subtitle')}
        </p>
        <InfrastructureMap />
      </section>

      <StatusDashboard />
    </div>
  );
}
