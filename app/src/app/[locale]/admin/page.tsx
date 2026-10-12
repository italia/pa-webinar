import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';

import { staffOLogin } from '@/lib/auth/staff-page';
import { localizedPath } from '@/lib/utils/localized-url';

interface AdminPageProps {
  searchParams: Promise<{ token?: string }>;
}

/**
 * L'ingresso dell'amministrazione e' l'elenco degli eventi, per tutto lo
 * staff: e' da li' che parte quasi ogni lavoro, e il menu porta al resto.
 */
export default async function AdminPage({ searchParams }: AdminPageProps) {
  const { token } = await searchParams;
  const locale = await getLocale();

  if (token) {
    redirect(localizedPath(`/admin/events?token=${encodeURIComponent(token)}`, locale));
  }

  await staffOLogin(locale);
  redirect(localizedPath('/admin/events', locale));
}
