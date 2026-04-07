'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Icon } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

const NAV_ITEMS = [
  { href: '/admin', icon: 'it-calendar', labelKey: 'events' },
  { href: '/admin/statistiche', icon: 'it-chart-line', labelKey: 'analytics' },
  { href: '/admin/impostazioni', icon: 'it-settings', labelKey: 'settings' },
  { href: '/admin/infrastruttura', icon: 'it-server', labelKey: 'infrastructure' },
] as const;

export default function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();

  function isActive(href: string): boolean {
    const stripped = pathname.replace(/^\/(it|en)/, '');
    if (href === '/admin') return stripped === '/admin';
    return stripped.startsWith(href);
  }

  return (
    <nav
      className="border-bottom"
      style={{ backgroundColor: '#f8f9fa' }}
      aria-label={t('ariaLabel')}
    >
      <div className="container">
        <ul className="nav nav-tabs border-0" style={{ marginBottom: -1 }}>
          {NAV_ITEMS.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="nav-item">
                <Link
                  href={item.href}
                  className={`nav-link d-inline-flex align-items-center gap-2 px-3 py-3 border-0 ${
                    active
                      ? 'text-primary fw-semibold'
                      : 'text-secondary'
                  }`}
                  style={{
                    borderBottom: active
                      ? '3px solid #0066CC'
                      : '3px solid transparent',
                    fontSize: '0.9rem',
                    borderRadius: 0,
                  }}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon icon={item.icon} size="sm" />
                  <span className="d-none d-sm-inline">{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
