'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from 'design-react-kit';

export default function AdminLogoutButton({ variant = 'button' }: { variant?: 'button' | 'nav' }) {
  const t = useTranslations('admin');
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    router.push('/admin/login');
  }

  if (variant === 'nav') {
    return (
      <button
        type="button"
        onClick={handleLogout}
        className="btn btn-link text-secondary d-inline-flex align-items-center gap-2 px-3 py-3 text-decoration-none"
        style={{ fontSize: '0.9rem' }}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
        {t('login.logout')}
      </button>
    );
  }

  return (
    <Button color="primary" outline size="sm" onClick={handleLogout}>
      {t('login.logout')}
    </Button>
  );
}
