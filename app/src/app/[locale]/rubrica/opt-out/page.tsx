import { getTranslations } from 'next-intl/server';

import RubricaOptOutClient from '@/components/rubrica/opt-out-client';

export default async function RubricaOptOutPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getTranslations('rubrica.optOut');
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="container py-5">
        <h1 className="fw-bold mb-3" style={{ color: 'var(--app-text)' }}>{t('title')}</h1>
        <p className="text-secondary">{t('missingToken')}</p>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <h1 className="fw-bold mb-3" style={{ color: 'var(--app-text)' }}>{t('title')}</h1>
      <p className="text-secondary mb-4">{t('intro')}</p>
      <RubricaOptOutClient token={token} />
    </div>
  );
}
