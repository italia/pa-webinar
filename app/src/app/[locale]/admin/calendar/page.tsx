import { getLocale, getTranslations } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import EventCalendar from '@/components/calendar/event-calendar-lazy';

export const dynamic = 'force-dynamic';

export default async function AdminCalendarPage() {
  // Aperta allo staff: gli eventi li filtra la rotta del calendario (ADR-014).
  await staffOLogin(await getLocale());
  const t = await getTranslations('calendar');

  return (
    <div className="container py-4">
      <div className="mb-4">
        <h1 className="h3 fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <EventCalendar mode="admin" />
    </div>
  );
}
