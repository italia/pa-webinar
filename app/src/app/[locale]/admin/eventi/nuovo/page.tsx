import { getTranslations } from 'next-intl/server';

import CreateEventForm from '@/components/admin/create-event-form';

export default async function CreateEventPage() {
  const t = await getTranslations('admin');

  return (
    <div className="container py-5">
      <div className="mb-2">
        <a
          href="/it/admin"
          className="text-decoration-none d-inline-flex align-items-center text-primary"
          style={{ fontSize: '0.9rem' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="me-1">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
          </svg>
          {t('title')}
        </a>
      </div>

      <h1 className="fw-bold mb-3" style={{ color: '#17324D' }}>
        {t('createEvent')}
      </h1>

      <div
        className="p-4 rounded mb-4"
        style={{
          backgroundColor: '#F5F7FB',
          borderLeft: '4px solid #0066CC',
          borderRadius: 8,
        }}
      >
        <p className="mb-0 fw-semibold" style={{ color: '#17324D' }}>
          {t('createEventExplanation')}
        </p>
      </div>

      <CreateEventForm />
    </div>
  );
}
