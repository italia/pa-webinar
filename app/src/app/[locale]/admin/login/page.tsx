'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button, Alert, Input, FormGroup, Label } from 'design-react-kit';

export default function AdminLoginPage() {
  const t = useTranslations('admin');
  const router = useRouter();

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
        router.push('/admin');
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
