import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import UploadPublicationForm from '@/components/admin/upload-publication-form';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/publications/new');
}

export default async function NewPublicationPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.publications.uploadPage');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/publications/new')} subtitle={t('subtitle')} />
      <UploadPublicationForm />
    </div>
  );
}
