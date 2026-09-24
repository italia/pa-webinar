import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import TemplateManagement from '@/components/admin/template-management';

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
      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <TemplateManagement templates={serialized} />
    </div>
  );
}
