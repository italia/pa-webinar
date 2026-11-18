// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { getLocale } from 'next-intl/server';

import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';
import RequestDetail from '@/components/admin/recording-removals/request-detail';
import { soloAdmin } from '@/lib/auth/staff-page';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/recording-removals/[id]');
}

/**
 * Una richiesta di rimozione e il suo editor. La pagina non apre la
 * registrazione: lo fanno le rotte dell'editor, in deroga e tracciate.
 */
export default async function RecordingRemovalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;
  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/recording-removals/[id]')} />
      <RequestDetail id={id} />
    </div>
  );
}
