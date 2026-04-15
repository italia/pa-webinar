import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import InstantCallsList from '@/components/admin/instant-calls-list';

export const dynamic = 'force-dynamic';

export default async function InstantCallsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) redirect(`/${locale}/admin/login`);

  const t = await getTranslations('admin.instantCalls');

  // Fetch settings once on the server so the client can show the
  // "auto-close in Xmin" hint for IDLE rows without a round trip.
  const settings = await prisma.siteSetting.findFirst({
    select: {
      jvbInactiveGraceMinutes: true,
    },
  });

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="mb-1">{t('title')}</h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <InstantCallsList
        locale={locale}
        idleGraceMinutes={settings?.jvbInactiveGraceMinutes ?? 45}
      />
    </div>
  );
}
