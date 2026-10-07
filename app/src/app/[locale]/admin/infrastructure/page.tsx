import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { getInfrastructureInfo } from '@/lib/infrastructure';
import InfrastructurePanel from '@/components/admin/infrastructure-panel';
import InfrastructureMap from '@/components/status/infrastructure-map';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/infrastructure');
}

export default async function InfrastructurePage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.infrastructure');
  const tMap = await getTranslations('infraMap');
  const info = await getInfrastructureInfo();

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/infrastructure')} subtitle={t('subtitle')} />

      <section className="mb-5">
        <h2 className="h4 fw-semibold mb-3">{tMap('title')}</h2>
        <p className="text-muted mb-3" style={{ fontSize: '0.88rem' }}>
          {tMap('subtitle')}
        </p>
        <InfrastructureMap />
      </section>

      <InfrastructurePanel info={info} />
    </div>
  );
}
