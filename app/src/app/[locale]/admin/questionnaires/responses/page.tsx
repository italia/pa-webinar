import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import QuestionnaireResponsesDashboard from '@/components/admin/questionnaire-responses-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/questionnaires/responses');
}

export default async function ResponsesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.questionnaireResponses');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/questionnaires/responses')} subtitle={t('subtitle')} />
      <QuestionnaireResponsesDashboard />
    </div>
  );
}
