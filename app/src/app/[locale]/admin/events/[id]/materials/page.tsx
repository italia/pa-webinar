import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import EventMaterialsManager, {
  type MaterialRow,
} from '@/components/admin/event-materials-manager';
import { staffOLogin } from '@/lib/auth/staff-page';
import { puoGestire } from '@/lib/auth/staff-session';
import AccessDenied from '@/components/admin/access-denied';
import { prisma } from '@/lib/db';
import { getLocalized, type LocalizedField } from '@/lib/utils/locale';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { eventPageMetadata } from '@/components/admin/admin-page-title';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const [{ id }, { token }] = await Promise.all([params, searchParams]);
  return eventPageMetadata('/admin/events/[id]/materials', id, { token, conToken: false });
}

export default async function EventMaterialsAdminPage({ params }: PageProps) {
  const { id } = await params;
  const locale = await getLocale();

  const session = await staffOLogin(locale);
  if (!UUID_RE.test(id)) notFound();

  const event = await prisma.event.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      title: true,
      materials: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!event) notFound();
  if (!(await puoGestire(session, event.id))) return <AccessDenied />;

  const t = await getTranslations('admin.materials');

  const titleMap = event.title as Record<string, string>;
  const eventTitle = getLocalized(titleMap as LocalizedField, locale) || event.slug;

  const initialMaterials: MaterialRow[] = event.materials.map((m) => ({
    id: m.id,
    eventId: m.eventId,
    type: (m.type === 'FILE' ? 'FILE' : 'LINK') as MaterialRow['type'],
    title: m.title,
    url: m.url,
    description: m.description,
    addedBy: m.addedBy,
    fileName: m.fileName,
    fileSize: m.fileSize !== null ? Number(m.fileSize) : null,
    mimeType: m.mimeType,
    blobPath: m.blobPath,
    visibility: ((['ALWAYS', 'BEFORE', 'DURING', 'AFTER'] as const).includes(
      m.visibility as MaterialRow['visibility'],
    )
      ? m.visibility
      : 'ALWAYS') as MaterialRow['visibility'],
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <div className="container py-5">
      <AdminPageHeader title={`${t('title')} — ${eventTitle}`} subtitle={t('subtitle')} />

      <EventMaterialsManager
        eventId={event.id}
        initialMaterials={initialMaterials}
      />
    </div>
  );
}
