import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import EmailTemplatesManagement from '@/components/admin/email-templates-management';

export default async function EmailTemplatesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.emailTemplates');

  return (
    <div className="container py-5">
      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <EmailTemplatesManagement />
    </div>
  );
}
