import { useTranslations } from 'next-intl';

export default function HomePage() {
  const t = useTranslations('events');

  return (
    <div className="container py-5">
      <h1>{t('upcoming')}</h1>
      <p className="lead text-muted">{t('noUpcoming')}</p>
    </div>
  );
}
