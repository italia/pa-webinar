import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getStaffSession } from '@/lib/auth/staff-session';

export default async function LocaleNotFound() {
  const t = await getTranslations('notFound');
  // Per lo staff la strada piu' probabile e' l'area riservata, da cui il link
  // veniva: la si offre accanto alla home.
  const staff = await getStaffSession(await cookies());

  return (
    <div className="container py-5 text-center">
      <h1 className="fw-bold">{t('title')}</h1>
      <p className="lead">{t('text')}</p>
      <div className="d-flex justify-content-center flex-wrap gap-2">
        <Link href="/" className="btn btn-primary">
          {t('home')}
        </Link>
        {staff && (
          <Link href="/admin" className="btn btn-outline-primary">
            {t('staffArea')}
          </Link>
        )}
      </div>
    </div>
  );
}
