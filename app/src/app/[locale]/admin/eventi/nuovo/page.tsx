import { getTranslations } from 'next-intl/server';

import CreateEventForm from '@/components/admin/create-event-form';

export default async function CreateEventPage() {
  const t = await getTranslations('admin');

  return (
    <div className="container py-5">
      <h1 className="mb-3">{t('createEvent')}</h1>

      <div
        className="p-4 rounded mb-4"
        style={{ backgroundColor: '#F5F7FB', borderLeft: '4px solid #0066CC' }}
      >
        <p className="mb-0 fw-semibold" style={{ color: '#17324D' }}>
          {t('createEventExplanation')}
        </p>
      </div>

      <CreateEventForm />
    </div>
  );
}
