import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';

import EventMaterialsManager, {
  type MaterialRow,
} from '@/components/admin/event-materials-manager';
import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';

interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventMaterialsAdminPage({ params }: PageProps) {
  const { id } = await params;
  const locale = await getLocale();

  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }
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

  const t = await getTranslations('admin.materials');
  const tCommon = await getTranslations('common');

  const titleMap = event.title as Record<string, string>;
  const eventTitle = titleMap[locale] ?? titleMap.it ?? event.slug;

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
      <div className="mb-4">
        <Link
          href={`/${locale}/admin/events/${event.id}`}
          className="text-decoration-none small"
        >
          ← {tCommon('back')}
        </Link>
        <h1 className="fw-bold mb-1 mt-2" style={{ color: '#17324D' }}>
          {t('title')} — {eventTitle}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>

      <EventMaterialsManager
        eventId={event.id}
        initialMaterials={initialMaterials}
      />
    </div>
  );
}
