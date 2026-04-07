import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { getInfrastructureInfo } from '@/lib/infrastructure';
import InfrastructurePanel from '@/components/admin/infrastructure-panel';

export default async function InfrastructurePage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());

  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.infrastructure');
  const info = await getInfrastructureInfo();

  return (
    <div className="container py-5">
      <h1 className="mb-2">{t('title')}</h1>
      <p className="text-secondary mb-4">{t('subtitle')}</p>
      <InfrastructurePanel info={info} />
    </div>
  );
}
