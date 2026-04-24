'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

interface Preview {
  displayName: string | null;
  organization: string | null;
  alreadyOptedOut: boolean;
}

export default function RubricaOptOutClient({ token }: { token: string }) {
  const t = useTranslations('rubrica.optOut');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/rubrica/opt-out?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401) {
          setError(t('invalidToken'));
        } else if (res.status === 404) {
          setError(t('notFound'));
        } else if (res.ok) {
          setPreview(await res.json());
        } else {
          setError(t('errors.generic'));
        }
      } catch {
        if (!cancelled) setError(t('errors.generic'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, t]);

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/rubrica/opt-out?token=${encodeURIComponent(token)}`, { method: 'POST' });
      if (res.ok) {
        setDone(true);
      } else {
        setError(t('errors.generic'));
      }
    } catch {
      setError(t('errors.generic'));
    } finally {
      setSubmitting(false);
    }
  }, [token, t]);

  if (loading) return <div className="text-muted">{t('loading')}</div>;
  if (error) return <div className="alert alert-danger">{error}</div>;
  if (!preview) return null;

  if (done || preview.alreadyOptedOut) {
    return (
      <div className="alert alert-success">
        <strong>{t('successTitle')}</strong>
        <p className="mb-0">{t('successBody')}</p>
      </div>
    );
  }

  return (
    <div className="card shadow-sm border-0" style={{ borderRadius: 8 }}>
      <div className="card-body p-4">
        <p className="mb-2">{t('previewHeader')}</p>
        <div className="mb-3">
          <div className="fw-semibold">{preview.displayName || '—'}</div>
          {preview.organization && <div className="text-muted small">{preview.organization}</div>}
        </div>
        <p className="text-muted small mb-4">{t('warning')}</p>
        <Button color="danger" onClick={handleConfirm} disabled={submitting}>
          {submitting ? t('submitting') : t('confirm')}
        </Button>
      </div>
    </div>
  );
}
