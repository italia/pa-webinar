'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button, Alert, Input, FormGroup, Label } from 'design-react-kit';

export default function AdminLoginPage() {
  const t = useTranslations('admin');
  const locale = useLocale();

  const [key, setKey] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });

      if (res.ok) {
        // Hard navigation (not router.push): after an idle re-login the App
        // Router client cache still holds the stale logged-out RSC for /admin,
        // so a soft push renders nothing until a manual reload (F14). A full
        // document request re-runs middleware with the fresh admin_session
        // cookie and lands on the real admin page.
        window.location.assign(`/${locale}/admin`);
        return;
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container py-5">
      <div style={{ maxWidth: 400 }} className="mx-auto">
        <h1 className="mb-4">{t('login.title')}</h1>

        {error && (
          <Alert color="danger" className="mb-3">
            {t('login.invalidKey')}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <FormGroup className="mb-3">
            <Label htmlFor="admin-key">{t('login.keyLabel')}</Label>
            <Input
              id="admin-key"
              type="password"
              value={key}
              placeholder={t('login.keyPlaceholder')}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setKey(e.target.value)
              }
              required
            />
          </FormGroup>

          <Button
            type="submit"
            color="primary"
            disabled={loading || !key}
            className="w-100"
          >
            {loading ? '...' : t('login.submit')}
          </Button>
        </form>
      </div>
    </div>
  );
}
