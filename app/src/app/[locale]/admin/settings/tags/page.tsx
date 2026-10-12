import { getTranslations, getLocale } from 'next-intl/server';

import { soloAdmin } from '@/lib/auth/staff-page';
import { prisma } from '@/lib/db';
import TagsManager from '@/components/admin/tags-manager';
import AdminPageHeader from '@/components/admin/admin-page-header';
import { adminPageMetadata, adminPageTitle } from '@/components/admin/admin-page-title';

export function generateMetadata() {
  return adminPageMetadata('/admin/settings/tags');
}

export default async function TagsSettingsPage() {
  const locale = await getLocale();
  const negato = await soloAdmin(locale);
  if (negato) return negato;

  const t = await getTranslations('admin.tags');

  const rows = await prisma.tag.findMany({
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  });

  // Serialize Date fields to strings so they are safe to hand to the
  // client island. The UI doesn't display them, but the Tag type on the
  // client stays JSON-shaped.
  const initialTags = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: (r.name as Record<string, string>) ?? {},
    color: r.color,
    sortOrder: r.sortOrder,
  }));

  return (
    <div className="container py-5">
      <AdminPageHeader title={await adminPageTitle('/admin/settings/tags')} subtitle={t('subtitle')} />

      <TagsManager initialTags={initialTags} />
    </div>
  );
}
