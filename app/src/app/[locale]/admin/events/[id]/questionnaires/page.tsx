import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import EventQuestionnairesManager from '@/components/admin/event-questionnaires-manager';
import { staffOLogin } from '@/lib/auth/staff-page';
import { puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import { prisma } from '@/lib/db';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title', { eventTitle })}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <EventQuestionnairesManager eventId={event.id} />
    </div>
  );
}
