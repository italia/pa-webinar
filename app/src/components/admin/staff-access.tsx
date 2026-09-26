'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import { localizedPath } from '@/lib/utils/localized-url';

/**
 * Dove porta il link di accesso mandato per email (ADR-014).
 *
 * Il link non si consuma all'apertura: serve un clic. I filtri antispam
 * aprono i link delle email per controllarli, e un consumo automatico
 * brucerebbe l'accesso prima che la persona lo veda.
 */
export default function StaffAccess({ token }: { token: string }) {
  const t = useTranslations('admin.staffLogin');
  const locale = useLocale();
  const [stato, setStato] = useState<'idle' | 'busy' | 'error'>('idle');

  async function entra() {
    setStato('busy');
    try {
      const res = await fetch('/api/staff/login-link/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        // Navigazione piena: il layout dell'area va ridisegnato con la
        // sessione appena aperta.
        window.location.assign(localizedPath('/admin/events', locale));
        return;
      }
      setStato('error');
    } catch {
      setStato('error');
    }
  }

  return (
    <div className="container py-5">
      <div style={{ maxWidth: 440 }} className="mx-auto">
        <h1 className="mb-3">{t('accessTitle')}</h1>
        {stato === 'error' || !token ? (
          <div className="callout callout-danger" role="alert">
            <p className="mb-3">{t('invalidLink')}</p>
            <Link href="/admin/login">{t('newLink')}</Link>
          </div>
        ) : (
          <>
            <p className="mb-4">{t('accessIntro')}</p>
            <Button color="primary" className="w-100" onClick={entra} disabled={stato === 'busy'}>
              {stato === 'busy' ? t('sending') : t('enter')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
