import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/**
 * Cosa vede una persona dello staff su una pagina che il suo ruolo non
 * apre. Non un rinvio al login — ci e' gia' entrata, e rimandarla li'
 * sarebbe un giro senza uscita — ma una spiegazione e la strada per tornare
 * ai propri eventi.
 */
export default async function AccessDenied() {
  const t = await getTranslations('admin.accessDenied');
  return (
    <div className="container py-5" style={{ maxWidth: 720 }}>
      <h1 className="h2 mb-3">{t('title')}</h1>
      <p className="mb-4">{t('body')}</p>
      <Link href="/admin/events" className="btn btn-primary">
        {t('back')}
      </Link>
    </div>
  );
}
