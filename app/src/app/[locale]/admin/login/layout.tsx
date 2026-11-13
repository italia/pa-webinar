// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

/** La pagina di accesso e' un componente client: il titolo della scheda sta qui. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('admin.staffLogin');
  return { title: t('title') };
}

export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return children;
}
