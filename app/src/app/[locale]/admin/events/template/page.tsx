import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import { getPublicEnv } from '@/lib/env';
import { resolveWhiteboardInfraReady } from '@/lib/jitsi/whiteboard';
import TemplateManagement from '@/components/admin/template-management';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/events/template');
}

export default async function TemplatesPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.templates');

  const templates = await prisma.eventTemplate.findMany({
    orderBy: { sortOrder: 'asc' },
  });

  const serialized = templates.map((tpl) => ({
    ...tpl,
    descriptionTemplate:
      (tpl.descriptionTemplate as Record<string, string> | null) ?? null,
    createdAt: tpl.createdAt.toISOString(),
    updatedAt: tpl.updatedAt.toISOString(),
  }));

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/events/template')} subtitle={t('subtitle')} />
      <TemplateManagement
        templates={serialized}
        // Letto a runtime come nella sala (lib/jitsi/whiteboard.ts).
        whiteboardInfraReady={resolveWhiteboardInfraReady(
          getPublicEnv('NEXT_PUBLIC_WHITEBOARD_ENABLED'),
        )}
      />
    </div>
  );
}
