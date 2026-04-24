import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import QuestionnaireResponsesDashboard from '@/components/admin/questionnaire-responses-dashboard';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export default async function ResponsesPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          Risposte questionari
        </h1>
        <p className="text-secondary mb-0">
          Aggregazioni per domanda, filtrabili per evento, fase e intervallo di date.
        </p>
      </div>
      <QuestionnaireResponsesDashboard />
    </div>
  );
}
