// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { getLocale, getTranslations } from 'next-intl/server';

import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';
import RequestsList from '@/components/admin/recording-removals/requests-list';
import { soloAdmin } from '@/lib/auth/staff-page';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/recording-removals');
}

/** Le richieste di non comparire in una registrazione: vanno al titolare, cioe' all'amministrazione. */
export default async function RecordingRemovalsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;
  const t = await getTranslations('admin.recordingRemovals');
  return (
    <div className="container py-5">
      <AdminPageHeader
        title={await adminPageTitle('/admin/recording-removals')}
        subtitle={t('subtitle')}
      />
      <RequestsList />
    </div>
  );
}
