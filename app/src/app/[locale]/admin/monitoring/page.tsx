import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { METRICS_APP_LABEL } from '@/lib/metrics';
import { bridgeMode } from '@/lib/status/bridge';
import { upSelector } from '@/lib/status/prometheus-selectors';
import MonitoringDashboard from '@/components/admin/monitoring-dashboard';

export default async function MonitoringPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.monitoring');

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="text-secondary mb-4">{t('subtitle')}</p>
      {/* Le etichette delle serie e la modalità del ponte le conosce solo il
          server: lette nel componente client resterebbero quelle del build. */}
      <MonitoringDashboard
        appLabel={METRICS_APP_LABEL}
        uptimeSelector={upSelector()}
        jvbScalerEnabled={bridgeMode() === 'scaler'}
      />
    </div>
  );
}
