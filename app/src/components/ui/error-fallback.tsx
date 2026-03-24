'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Icon } from 'design-react-kit';

interface ErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorFallback({ error, reset }: ErrorFallbackProps) {
  const t = useTranslations('common');

  return (
    <div className="container py-5" style={{ maxWidth: 640 }}>
      <Alert color="danger">
        <Icon icon="it-close-circle" className="me-2" />
        <strong>{t('error')}</strong>
        {error.message && (
          <p className="mt-2 mb-0 small">{error.message}</p>
        )}
      </Alert>

      <div className="text-center mt-4">
        <Button color="primary" onClick={reset}>
          <Icon icon="it-refresh" size="sm" className="me-2" />
          {t('retry')}
        </Button>
      </div>
    </div>
  );
}
