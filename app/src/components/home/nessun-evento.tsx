import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';

/**
 * Nessun evento in programma: una riga sola, con dove andare (gli eventi
 * passati e le registrazioni), invece di un riquadro vuoto che lascia solo
 * spazio bianco.
 */
export default async function NessunEvento({ testo }: { testo: string }) {
  const t = await getTranslations('home');
  return (
    <div
      className="px-4 py-3 rounded-3 d-flex flex-wrap align-items-center justify-content-between gap-2"
      style={{ backgroundColor: '#F5F7FB' }}
    >
      <p className="text-secondary mb-0">{testo}</p>
      <span className="d-inline-flex flex-wrap gap-2">
        <Link href="/events" className="btn btn-outline-primary btn-sm">
          {t('upcoming.seePast')}
        </Link>
        <Link href="/video-library" className="btn btn-outline-primary btn-sm">
          {t('upcoming.seeRecordings')}
        </Link>
      </span>
    </div>
  );
}
