import { getLocale, getTranslations } from 'next-intl/server';

import GlossaryManager from '@/components/admin/glossary-manager';
import { staffOLogin } from '@/lib/auth/staff-page';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

/** Il glossario dell'istanza per la post-produzione AI: vale per tutti gli
 *  eventi (lib/ai/glossary.ts). Lo apre tutto lo staff: chi organizza lo
 *  arricchisce e modifica le voci che ha aggiunto. */
export function generateMetadata() {
  return adminPageMetadata('/admin/glossary');
}

export default async function GlossaryPage() {
  const locale = await getLocale();
  const session = await staffOLogin(locale);
  const admin = session.role === 'admin';

  const t = await getTranslations('admin.glossary');

  return (
    <div className="container py-5">
      <AdminPageHeader
        title={await adminPageTitle('/admin/glossary')}
        subtitle={admin ? t('subtitle') : `${t('subtitle')} ${t('organizerNote')}`}
      />
      <GlossaryManager apiBase="/api/admin/glossary" scope="instance" />
    </div>
  );
}
