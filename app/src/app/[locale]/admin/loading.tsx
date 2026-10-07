'use client';

import { Spinner } from 'design-react-kit';
import { useTranslations } from 'next-intl';

export default function AdminLoading() {
  const tc = useTranslations('common');
  return (
    <div
      className="d-flex flex-column align-items-center justify-content-center"
      style={{ minHeight: '60vh' }}
      role="status"
    >
      <Spinner active double aria-label={tc('loading')} />
    </div>
  );
}
