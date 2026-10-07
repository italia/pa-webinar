import { getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
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

  // Il ritorno all'elenco lo danno le briciole.
  return (
    <div className="container py-5">
      <RubricaDetail id={id} />
    </div>
  );
}
