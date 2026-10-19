import { getTranslations, getLocale } from 'next-intl/server';

import { staffOLogin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import InstantCallsList from '@/components/admin/instant-calls-list';
import { Link } from '@/i18n/navigation';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return adminPageMetadata('/admin/events/calls');
}

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
      <AdminPageHeader
        title={await adminPageTitle('/admin/events/calls')}
        subtitle={t('subtitle')}
        // La creazione e' quella dell'elenco degli eventi: lo stesso modulo,
        // che crea la stanza e ci porta dentro.
        actions={
          <Link
            href={{ pathname: '/admin/events/new', query: { instant: '1' } }}
            className="btn btn-primary d-inline-flex align-items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            {t('createNew')}
          </Link>
        }
      />
      <InstantCallsList
        locale={locale}
        idleGraceMinutes={settings?.jvbInactiveGraceMinutes ?? 45}
      />
    </div>
  );
}
