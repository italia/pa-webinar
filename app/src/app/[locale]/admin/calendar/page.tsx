// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import { redirect } from 'next/navigation';
import { getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { localizedPath } from '@/lib/utils/localized-url';

export const dynamic = 'force-dynamic';

/**
 * Il calendario dello staff e' una vista di «Tutti gli eventi»: questo
 * indirizzo resta per i collegamenti salvati e porta li'.
 */
export default async function AdminCalendarPage() {
  const locale = await getLocale();
  // Come l'elenco: aperta allo staff (ADR-014), senza sessione all'accesso.
  await staffOLogin(locale);
  redirect(localizedPath('/admin/events?vista=calendario', locale));
}
