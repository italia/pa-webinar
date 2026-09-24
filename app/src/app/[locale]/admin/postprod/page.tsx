import { getTranslations, getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import PostprodDashboard from '@/components/admin/postprod-dashboard';

export const dynamic = 'force-dynamic';

export default async function PostprodPage() {
  const locale = await getLocale();
  // Aperta allo staff: le registrazioni le filtra la rotta (ADR-014).
  await staffOLogin(locale);

  const t = await getTranslations('admin.postprod');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <PostprodDashboard />
    </div>
  );
}
