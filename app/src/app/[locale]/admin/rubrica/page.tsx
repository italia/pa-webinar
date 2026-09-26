import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import RubricaList from '@/components/admin/rubrica-list';

export default async function RubricaPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.rubrica');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <RubricaList />
    </div>
  );
}
