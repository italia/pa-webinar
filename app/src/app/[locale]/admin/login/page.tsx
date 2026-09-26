'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button, Alert, Input, FormGroup, Label } from 'design-react-kit';

import { DURATA_LINK_MINUTI } from '@/lib/auth/staff-link-config';
import { localizedPath } from '@/lib/utils/localized-url';

export default function AdminLoginPage() {
  const t = useTranslations('admin');
  const locale = useLocale();

  const tl = useTranslations('admin.staffLogin');
  const [key, setKey] = useState('');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  // Accesso con link per email (ADR-014): la strada di chi organizza eventi.
  const [email, setEmail] = useState('');
  const [linkState, setLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function richiediLink(e: FormEvent) {
    e.preventDefault();
    setLinkState('sending');
    try {
      const res = await fetch('/api/staff/login-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, locale }),
      });
      // 202 anche per indirizzi sconosciuti: il messaggio non dice se
      // l'account esiste, e non deve.
      setLinkState(res.status === 202 ? 'sent' : 'error');
    } catch {
      setLinkState('error');
    }
  }

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
        // so a soft push renders nothing until a manual reload. A full
        // document request re-runs middleware with the fresh admin_session
        // cookie and lands on the real admin page.
        window.location.assign(localizedPath('/admin', locale));
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
      <div style={{ maxWidth: 440 }} className="mx-auto">
        <h1 className="mb-2">{tl('title')}</h1>
        <p className="text-secondary mb-4">{tl('intro')}</p>

        {linkState === 'sent' ? (
          <div className="callout callout-success mb-4" role="status">
            <p className="mb-0">{tl('sent', { minutes: DURATA_LINK_MINUTI })}</p>
          </div>
        ) : (
          <form onSubmit={richiediLink} className="mb-4">
            {linkState === 'error' && (
              <Alert color="danger" className="mb-3">
                {tl('error')}
              </Alert>
            )}
            <FormGroup className="mb-3">
              <Label htmlFor="staff-email">{tl('emailLabel')}</Label>
              <Input
                id="staff-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                required
              />
            </FormGroup>
            <Button
              type="submit"
              color="primary"
              disabled={linkState === 'sending' || !email}
              className="w-100"
            >
              {linkState === 'sending' ? tl('sending') : tl('send')}
            </Button>
          </form>
        )}

        {/* La chiave dell'istanza: per chi amministra la piattaforma, non per
            chi organizza. Chiusa di default, per non chiedere a tutti una
            cosa che quasi nessuno ha. */}
        <details className="border-top pt-3">
          <summary className="text-secondary" style={{ cursor: 'pointer' }}>
            {tl('keySection')}
          </summary>
          <div className="pt-3">
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
                outline
                disabled={loading || !key}
                className="w-100"
              >
                {loading ? '...' : t('login.submit')}
              </Button>
            </form>
          </div>
        </details>
      </div>
    </div>
  );
}
