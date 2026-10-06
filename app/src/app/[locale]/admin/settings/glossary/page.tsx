import { getLocale, getTranslations } from 'next-intl/server';

import GlossaryManager from '@/components/admin/glossary-manager';
import { Link } from '@/i18n/navigation';
import { staffOLogin } from '@/lib/auth/staff-page';

/** Il glossario dell'istanza per la post-produzione AI: vale per tutti gli
 *  eventi (lib/ai/glossary.ts). Lo apre tutto lo staff: chi organizza lo
 *  arricchisce e modifica le voci che ha aggiunto. */
export default async function GlossarySettingsPage() {
  const locale = await getLocale();
  const session = await staffOLogin(locale);
  const admin = session.role === 'admin';

  const t = await getTranslations('admin.glossary');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <Link
          href={admin ? '/admin/settings' : '/admin/events'}
          className="text-decoration-none"
          style={{ color: 'var(--app-primary)', fontSize: '0.9rem' }}
        >
          {'←'} {admin ? t('backToSettings') : t('backToEvents')}
        </Link>
      </div>
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0" style={{ maxWidth: 760 }}>
          {t('subtitle')}
        </p>
        {!admin && (
          <p className="text-secondary mt-2 mb-0" style={{ maxWidth: 760 }}>
            {t('organizerNote')}
          </p>
        )}
      </div>
      <GlossaryManager apiBase="/api/admin/glossary" scope="instance" />
    </div>
  );
}
