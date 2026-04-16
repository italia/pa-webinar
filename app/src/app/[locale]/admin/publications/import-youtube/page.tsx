import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';

import { isAdminAuthenticated } from '@/lib/auth/admin-session';
import ImportYoutubeForm from '@/components/admin/import-youtube-form';

export const dynamic = 'force-dynamic';

export default async function ImportYoutubePage() {
  const locale = await getLocale();
  const isAdmin = await isAdminAuthenticated(await cookies());
  if (!isAdmin) {
    redirect(`/${locale}/admin/login`);
  }

  const t = await getTranslations('admin.publications.importYoutubePage');

  return (
    <div className="container py-5">
      <div className="mb-4">
        <h1 className="fw-bold mb-1" style={{ color: '#17324D' }}>
          {t('title')}
        </h1>
        <p className="text-secondary mb-0">{t('subtitle')}</p>
      </div>
      <ImportYoutubeForm />
    </div>
  );
}
