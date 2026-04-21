import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import RubricaDetail from '@/components/admin/rubrica-detail';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export default async function RubricaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }
  const { id } = await params;

  return (
    <div className="container py-5">
      <div className="mb-3">
        <Link href="/admin/rubrica" className="text-decoration-none small">
          ← Torna alla rubrica
        </Link>
      </div>
      <RubricaDetail id={id} />
    </div>
  );
}
