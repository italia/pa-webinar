'use client';

import { useCallback, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Button, Input, Label } from 'design-react-kit';

import { useRouter } from '@/i18n/navigation';

export default function PasswordGateClient({ slug }: { slug: string }) {
  const t = useTranslations('live.password');
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch(`/api/events/${slug}/verify-password`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (res.status === 403) {
          setError(t('wrong'));
          return;
        }
        if (res.status === 429) {
          setError(t('rateLimited'));
          return;
        }
        if (!res.ok) {
          setError(t('generic'));
          return;
        }
        router.push(`/events/${slug}/live`);
      } catch {
        setError(t('generic'));
      } finally {
        setSubmitting(false);
      }
    },
    [password, slug, router, t],
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      {error && (
        <Alert color="danger" className="mb-3">
          {error}
        </Alert>
      )}
      <div className="mb-3">
        <Label htmlFor="join-password">{t('label')}</Label>
        <Input
          id="join-password"
          type="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
      </div>
      <Button
        color="primary"
        type="submit"
        disabled={submitting || password.length < 1}
        className="w-100"
      >
        {submitting ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
