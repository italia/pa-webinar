import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import InstantCallsList from '@/components/admin/instant-calls-list';

export const dynamic = 'force-dynamic';

export default async function InstantCallsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) redirect(`/${locale}/admin/login`);

  const t = await getTranslations('admin.instantCalls');

  const calls = await prisma.event.findMany({
    where: { eventType: 'INSTANT' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      createdAt: true,
      moderatorName: true,
      moderatorToken: true,
      peakParticipants: true,
      recordingUrl: true,
      recordingDuration: true,
      recordingFileSize: true,
      _count: { select: { callSessions: true, registrations: true } },
    },
    take: 100,
  });

  // Serialise BigInt fields so the payload survives the RSC boundary
  // (BigInt isn't JSON-serialisable).
  const serialised = calls.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: getLocalized(c.title as LocalizedField, locale),
    status: c.status,
    createdAt: c.createdAt.toISOString(),
    moderatorName: c.moderatorName,
    moderatorToken: c.moderatorToken,
    peakParticipants: c.peakParticipants,
    recordingUrl: c.recordingUrl,
    recordingDuration: c.recordingDuration,
    recordingFileSize: c.recordingFileSize?.toString() ?? null,
    callSessionsCount: c._count.callSessions,
    registrationsCount: c._count.registrations,
  }));

  return (
    <div className="container py-5">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="mb-1">{t('title')}</h1>
          <p className="text-secondary mb-0">{t('subtitle')}</p>
        </div>
      </div>
      <InstantCallsList calls={serialised} locale={locale} />
    </div>
  );
}
