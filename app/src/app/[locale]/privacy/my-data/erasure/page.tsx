'use client';

import { useState, useCallback, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormGroup,
  Icon,
  Input,
} from 'design-react-kit';

type Phase = 'idle' | 'submitting' | 'requestSent' | 'confirmed' | 'error';

export default function ErasurePage() {
  const t = useTranslations('gdpr.erasure');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get('t');

  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [deletedCount, setDeletedCount] = useState(0);

  const handleRequest = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError('');

      if (!email.trim() || !email.includes('@')) {
        setError(t('emailInvalid'));
        return;
      }

      setPhase('submitting');
      try {
        const res = await fetch('/api/gdpr/erasure/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), locale }),
        });
        if (res.status === 429) {
          setError(t('rateLimited'));
          setPhase('error');
          return;
        }
        if (!res.ok) {
          setError(t('error'));
          setPhase('error');
          return;
        }
        setPhase('requestSent');
      } catch {
        setError(t('error'));
        setPhase('error');
      }
    },
    [email, locale, t],
  );

  const handleConfirm = useCallback(async () => {
    if (!token) return;
    setPhase('submitting');
    setError('');
    try {
      const res = await fetch(
        `/api/gdpr/erasure?t=${encodeURIComponent(token)}`,
        { method: 'POST', cache: 'no-store' },
      );
      if (res.status === 401 || res.status === 400) {
        setError(t('linkInvalid'));
        setPhase('error');
        return;
      }
      if (!res.ok) {
        setError(t('error'));
        setPhase('error');
        return;
      }
      const json = await res.json();
      setDeletedCount(typeof json.deleted === 'number' ? json.deleted : 0);
      setPhase('confirmed');
    } catch {
      setError(t('error'));
      setPhase('error');
    }
  }, [token, t]);

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-8">
          <h1 className="mb-2">{t('title')}</h1>
          <p className="lead text-muted mb-4">{t('subtitle')}</p>

          {/* ── No token: request flow ── */}
          {!token && phase !== 'requestSent' && (
            <Card className="shadow-sm border-0 mb-4" style={{ borderRadius: 8, border: '1px solid #e8e8e8' }}>
              <CardBody className="p-4">
                <form onSubmit={handleRequest}>
                  {error && (
                    <Alert color="danger" className="mb-3">
                      {error}
                    </Alert>
                  )}
                  <FormGroup className="mb-3">
                    <Input
                      type="email"
                      id="erasure-email"
                      label={t('emailLabel')}
                      placeholder={t('emailPlaceholder')}
                      value={email}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setEmail(e.target.value)
                      }
                      required
                    />
                  </FormGroup>
                  <Button color="danger" type="submit" disabled={phase === 'submitting'}>
                    {t('submit')}
                  </Button>
                </form>
              </CardBody>
            </Card>
          )}

          {!token && phase === 'requestSent' && (
            <Alert color="success">
              <h2 className="h5 mb-2">{t('requestSubmittedTitle')}</h2>
              <p className="mb-0">{t('requestSubmittedBody')}</p>
            </Alert>
          )}

          {/* ── Token: confirm flow ── */}
          {token && phase === 'idle' && (
            <Card className="shadow-sm border-0">
              <CardBody className="p-4">
                <Alert color="warning" className="mb-3">
                  <Icon icon="it-warning-circle" className="me-2" />
                  {t('confirmWarning')}
                </Alert>
                <p>{t('confirmBody')}</p>
                <div className="d-flex gap-2 mt-3">
                  <Button color="danger" onClick={handleConfirm}>
                    {t('confirmButton')}
                  </Button>
                  <Button color="secondary" outline href={`/${locale}/privacy/my-data`}>
                    {t('cancel')}
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {token && phase === 'submitting' && (
            <Alert color="info">
              <Icon icon="it-info-circle" className="me-2" />
              {t('processing')}
            </Alert>
          )}

          {token && phase === 'confirmed' && (
            <Alert color="success">
              <h2 className="h5 mb-2">{t('doneTitle')}</h2>
              <p className="mb-0">{t('doneBody', { count: deletedCount })}</p>
            </Alert>
          )}

          {token && phase === 'error' && (
            <Alert color="danger">
              {error}
              <div className="mt-3">
                <Button color="primary" outline href={`/${locale}/privacy/my-data/erasure`}>
                  {t('back')}
                </Button>
              </div>
            </Alert>
          )}
        </div>
      </div>
    </div>
  );
}
