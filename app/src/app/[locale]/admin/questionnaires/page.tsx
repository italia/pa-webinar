import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import QuestionTemplatesManagement from '@/components/admin/question-templates-management';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export default async function QuestionnairesPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  return (
    <div className="container py-5">
      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          Questionari
        </h1>
        <p className="text-secondary mb-0">
          Template riutilizzabili di domande per i questionari di pre-registrazione e post-evento.
        </p>
      </div>
      <QuestionTemplatesManagement />
    </div>
  );
}
