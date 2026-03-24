'use client';

import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { Button } from 'design-react-kit';

export default function AdminLogoutButton() {
  const t = useTranslations('admin');
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push(`/${locale}/admin/login`);
  }

  return (
    <Button color="primary" outline size="sm" onClick={handleLogout}>
      {t('login.logout')}
    </Button>
  );
}
