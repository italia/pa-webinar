import { getLocale, getTranslations } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { Link } from '@/i18n/navigation';
import RubricaDetail from '@/components/admin/rubrica-detail';

export default async function RubricaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;
  const { id } = await params;

  const t = await getTranslations('admin.rubrica');

  return (
    <div className="container py-5">
      <div className="mb-3">
        <Link href="/admin/rubrica" className="text-decoration-none small">
          {t('backToList')}
        </Link>
      </div>
      <RubricaDetail id={id} />
    </div>
  );
}
