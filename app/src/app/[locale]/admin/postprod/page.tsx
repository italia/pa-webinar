import { getTranslations, getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import PostprodDashboard from '@/components/admin/postprod-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/postprod');
}

export default async function PostprodPage() {
  const locale = await getLocale();
  // Aperta allo staff: le registrazioni le filtra la rotta (ADR-014).
  await staffOLogin(locale);

  const t = await getTranslations('admin.postprod');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/postprod')} subtitle={t('subtitle')} />
      <PostprodDashboard />
    </div>
  );
}
