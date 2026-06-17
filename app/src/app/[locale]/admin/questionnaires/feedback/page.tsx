import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import FeedbackDashboard from '@/components/admin/feedback-dashboard';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export default async function AdminFeedbackPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('feedbackAdmin');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
      </div>
      <FeedbackDashboard />
    </div>
  );
}
