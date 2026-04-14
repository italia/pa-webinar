'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Icon } from 'design-react-kit';

import { Link } from '@/i18n/navigation';

interface NavItem {
  href: string;
  icon: string;
  labelKey: string;
  exact?: boolean;
}

const MAIN_SECTIONS: NavItem[] = [
  { href: '/admin/events', icon: 'it-calendar', labelKey: 'events' },
  { href: '/admin/settings', icon: 'it-settings', labelKey: 'settings' },
];

const EVENTS_SUB_NAV: NavItem[] = [
  { href: '/admin/events', icon: 'it-list', labelKey: 'eventsList', exact: true },
  { href: '/admin/events/new', icon: 'it-plus', labelKey: 'newEvent' },
  { href: '/admin/calendar', icon: 'it-calendar', labelKey: 'calendar' },
  { href: '/admin/events/template', icon: 'it-copy', labelKey: 'templates' },
  { href: '/admin/events/statistics', icon: 'it-chart-line', labelKey: 'analytics' },
];

const SETTINGS_SUB_NAV: NavItem[] = [
  { href: '/admin/settings', icon: 'it-settings', labelKey: 'settingsGeneral', exact: true },
  { href: '/admin/settings/languages', icon: 'it-hearing', labelKey: 'settingsLanguages' },
  { href: '/admin/infrastructure', icon: 'it-server', labelKey: 'infrastructure' },
  { href: '/admin/monitoring', icon: 'it-chart-line', labelKey: 'monitoring' },
];

export default function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();

  const stripped = pathname.replace(/^\/[a-z]{2}/, '');
  const inEvents = stripped.startsWith('/admin/events') || stripped.startsWith('/admin/calendar');
  const inSettings = stripped.startsWith('/admin/settings') || stripped.startsWith('/admin/infrastructure') || stripped.startsWith('/admin/monitoring');

  function isActive(item: NavItem): boolean {
    if (item.exact) return stripped === item.href;
    if (item.href === '/admin/events' && !item.exact) return inEvents;
    if (item.href === '/admin/settings') return inSettings;
    return stripped.startsWith(item.href);
  }

  function isSubActive(item: NavItem): boolean {
    if (item.exact) return stripped === item.href;
    return stripped.startsWith(item.href);
  }

  const subNav = inEvents ? EVENTS_SUB_NAV : inSettings ? SETTINGS_SUB_NAV : null;

  return (
    <div>
      <nav
        style={{ backgroundColor: '#f8f9fa', borderBottom: '1px solid #d9dadb' }}
        aria-label={t('ariaLabel')}
      >
        <div className="container">
          <ul className="nav" style={{ gap: 0 }}>
            {MAIN_SECTIONS.map((item) => {
              const active = isActive(item);
              return (
                <li key={item.href} className="nav-item">
                  <Link
                    href={item.href}
                    className={`nav-link d-inline-flex align-items-center gap-2 px-3 py-3 ${
                      active ? 'text-primary fw-semibold' : 'text-secondary'
                    }`}
                    style={{
                      borderBottom: active
                        ? '3px solid #0066CC'
                        : '3px solid transparent',
                      fontSize: '0.9rem',
                      borderRadius: 0,
                      marginBottom: '-1px',
                    }}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon icon={item.icon} size="sm" />
                    <span className="d-none d-sm-inline">
                      {t(item.labelKey)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      {subNav && (
        <nav
          style={{
            backgroundColor: '#fff',
            borderBottom: '1px solid #e8e8e8',
          }}
          aria-label={t('subNavAriaLabel')}
        >
          <div className="container">
            <ul className="nav" style={{ gap: 0 }}>
              {subNav.map((item) => {
                const active = isSubActive(item);
                return (
                  <li key={item.href} className="nav-item">
                    <Link
                      href={item.href}
                      className={`nav-link d-inline-flex align-items-center gap-2 px-3 py-2 ${
                        active ? 'text-primary fw-semibold' : 'text-muted'
                      }`}
                      style={{
                        borderBottom: active
                          ? '2px solid #0066CC'
                          : '2px solid transparent',
                        fontSize: '0.85rem',
                        borderRadius: 0,
                        marginBottom: '-1px',
                      }}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon icon={item.icon} size="xs" />
                      <span className="d-none d-sm-inline">
                        {t(item.labelKey)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      )}
    </div>
  );
}
