import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { getSettings } from '@/lib/settings';
import EventCalendar from '@/components/calendar/event-calendar';

export const dynamic = 'force-dynamic';

export default async function PublicCalendarPage() {
  const settings = await getSettings();

  if (!settings.calendarPublic) {
    notFound();
  }

  const t = await getTranslations('calendar');

  return (
    <div className="container py-5">
      <div className="text-center mb-5">
        <h1 className="h2 fw-bold mb-2" style={{ color: '#17324D' }}>
          {t('publicTitle')}
        </h1>
        <p className="text-secondary">{t('publicSubtitle')}</p>
      </div>
      <EventCalendar mode="public" />
    </div>
  );
}
