import { getLocale, getTranslations } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import EventCalendar from '@/components/calendar/event-calendar-lazy';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/calendar');
}

export default async function AdminCalendarPage() {
  // Aperta allo staff: gli eventi li filtra la rotta del calendario (ADR-014).
  await staffOLogin(await getLocale());
  const t = await getTranslations('calendar');

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/calendar')} subtitle={t('subtitle')} />
      <EventCalendar mode="admin" />
    </div>
  );
}
