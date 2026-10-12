import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import EventQuestionnairesManager from '@/components/admin/event-questionnaires-manager';
import { staffOLogin } from '@/lib/auth/staff-page';
import { puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { prisma } from '@/lib/db';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { eventPageMetadata } from '@/components/admin/admin-page-title';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  return eventPageMetadata('/admin/events/[id]/questionnaires', id, { token, conToken: false });
}

export default async function EventQuestionnairesPage({ params }: PageProps) {
  const { id } = await params;
  const locale = await getLocale();

  const session = await staffOLogin(locale);
  if (!UUID_RE.test(id)) notFound();

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true },
  });
  if (!event) notFound();
  if (!(await puoGestire(session, event.id))) return <AccessDenied />;

  const eventTitle = getLocalized(event.title as LocalizedField, locale) || event.slug;
  const t = await getTranslations('admin.eventQuestionnaires');

  return (
    <div className="container py-5">
      <AdminPageHeader title={t('title', { eventTitle })} subtitle={t('subtitle')} />
      <EventQuestionnairesManager eventId={event.id} />
    </div>
  );
}
