'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from 'design-react-kit';

export default function AdminLogoutButton() {
  const t = useTranslations('admin');
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  return (
    <Button color="primary" outline size="sm" onClick={handleLogout}>
      {t('login.logout')}
    </Button>
  );
}
