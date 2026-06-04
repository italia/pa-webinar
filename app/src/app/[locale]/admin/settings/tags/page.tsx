import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import { prisma } from '@/lib/db';
import { Link } from '@/i18n/navigation';
import TagsManager from '@/components/admin/tags-manager';

export default async function TagsSettingsPage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

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
      <div className="mb-4">
        <Link
          href="/admin/settings"
          className="text-decoration-none"
          style={{ color: 'var(--app-primary)', fontSize: '0.9rem' }}
        >
          {'←'} {t('backToSettings')}
        </Link>
      </div>

      <div className="mb-5">
        <h1 className="fw-bold mb-1" style={{ color: 'var(--app-text)' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>

      <TagsManager initialTags={initialTags} />
    </div>
  );
}
