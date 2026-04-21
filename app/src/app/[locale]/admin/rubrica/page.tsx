import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import RubricaList from '@/components/admin/rubrica-list';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';

export default async function RubricaPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          Rubrica
        </h1>
        <p className="text-secondary mb-0">
          Persone che hanno dato consenso all&rsquo;inserimento in rubrica (art. 6.1.a GDPR).
          Le informazioni di profilo vengono aggiornate automaticamente ad ogni re-iscrizione.
        </p>
      </div>
      <RubricaList />
    </div>
  );
}
