import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import QuestionTemplatesManagement from '@/components/admin/question-templates-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/questionnaires');
}

export default async function QuestionnairesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.questionnairesPage');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/questionnaires')} subtitle={t('subtitle')} />
      <QuestionTemplatesManagement />
    </div>
  );
}
