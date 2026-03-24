import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';

export default function LocaleNotFound() {
  const t = useTranslations('common');

  return (
    <div className="container py-5 text-center">
      <h1 className="display-1 fw-bold">404</h1>
      <p className="lead">{t('error')}</p>
      <Link href="/" className="btn btn-primary">
        {t('back')}
      </Link>
    </div>
  );
}
