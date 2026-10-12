import { getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import FeedbackDashboard from '@/components/admin/feedback-dashboard';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/questionnaires/feedback');
}

export default async function AdminFeedbackPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;


  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/questionnaires/feedback')} />
      <FeedbackDashboard />
    </div>
  );
}
