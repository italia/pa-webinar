import { getTranslations, getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import InstantCallsList from '@/components/admin/instant-calls-list';

export const dynamic = 'force-dynamic';

export default async function InstantCallsPage() {
  const locale = await getLocale();
  // Aperta anche agli organizzatori: l'elenco lo filtra la rotta (ADR-014).
  await staffOLogin(locale);

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
