import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import EventQuestionnairesManager from '@/components/admin/event-questionnaires-manager';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventQuestionnairesPage({ params }: PageProps) {
  const { id } = await params;
  const locale = await getLocale();

  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }
  if (!UUID_RE.test(id)) notFound();

  const event = await prisma.event.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true },
  });
  if (!event) notFound();

  const eventTitle = (event.title as Record<string, string>)[locale] ?? (event.title as Record<string, string>).it ?? event.slug;
  const t = await getTranslations('admin.eventQuestionnaires');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          {t('title', { eventTitle })}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <EventQuestionnairesManager eventId={event.id} />
    </div>
  );
}
