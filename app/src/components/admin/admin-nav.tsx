'use client';

import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

import { Link, usePathname } from '@/i18n/navigation';

interface NavItem {
  href: string;
  icon: string;
  labelKey: string;
  exact?: boolean;
}

const MAIN_SECTIONS: NavItem[] = [
  { href: '/admin/events', icon: 'it-calendar', labelKey: 'events' },
  { href: '/admin/registrations', icon: 'it-user', labelKey: 'registrations' },
  { href: '/admin/publications', icon: 'it-files', labelKey: 'publications' },
  { href: '/admin/recordings', icon: 'it-video', labelKey: 'recordings' },
  { href: '/admin/monitoring', icon: 'it-presentation', labelKey: 'monitoring' },
  { href: '/admin/settings', icon: 'it-settings', labelKey: 'settings' },
];

const EVENTS_SUB_NAV: NavItem[] = [
  { href: '/admin/events', icon: 'it-list', labelKey: 'eventsList', exact: true },
  { href: '/admin/events/new', icon: 'it-plus', labelKey: 'newEvent' },
  { href: '/admin/events/calls', icon: 'it-video', labelKey: 'instantCalls' },
  { href: '/admin/calendar', icon: 'it-calendar', labelKey: 'calendar' },
  { href: '/admin/events/template', icon: 'it-copy', labelKey: 'templates' },
  { href: '/admin/events/statistics', icon: 'it-chart-line', labelKey: 'analytics' },
];

// Registrations area groups cross-event attendee management.
const REGISTRATIONS_SUB_NAV: NavItem[] = [
  { href: '/admin/registrations', icon: 'it-user', labelKey: 'registrationsList', exact: true },
  { href: '/admin/moderators', icon: 'it-key', labelKey: 'moderators' },
  { href: '/admin/gdpr-audit', icon: 'it-files', labelKey: 'gdprAudit' },
];

// Recordings / instant calls / live sessions — everything video-output.
const RECORDINGS_SUB_NAV: NavItem[] = [
  { href: '/admin/recordings', icon: 'it-video', labelKey: 'recordingsList', exact: true },
];

// Publications area: unified library editing.
const PUBLICATIONS_SUB_NAV: NavItem[] = [
  { href: '/admin/publications', icon: 'it-files', labelKey: 'publicationsList', exact: true },
  { href: '/admin/publications/new', icon: 'it-plus', labelKey: 'publicationsNew' },
];

// Monitoring groups together all the observability surfaces.
const MONITORING_SUB_NAV: NavItem[] = [
  { href: '/admin/monitoring', icon: 'it-presentation', labelKey: 'monitoringDashboard', exact: true },
  { href: '/admin/infrastructure', icon: 'it-server', labelKey: 'infrastructure' },
];

const SETTINGS_SUB_NAV: NavItem[] = [
  { href: '/admin/settings', icon: 'it-settings', labelKey: 'settingsGeneral', exact: true },
  { href: '/admin/settings/languages', icon: 'it-hearing', labelKey: 'settingsLanguages' },
  { href: '/admin/settings/gdpr-templates', icon: 'it-lock', labelKey: 'settingsGdprTemplates' },
];

export default function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();

  const stripped = pathname.replace(/^\/[a-z]{2}/, '');
  const inEvents = stripped.startsWith('/admin/events') || stripped.startsWith('/admin/eventi')
    || stripped.startsWith('/admin/calendar') || stripped.startsWith('/admin/calendario');
  // Monitoring area groups /admin/monitoring and /admin/infrastructure.
  // These used to live under Settings but they are operational views,
  // not configuration — so they get their own top-level section.
  const inMonitoring = stripped.startsWith('/admin/monitoring')
    || stripped.startsWith('/admin/infrastructure')
    || stripped.startsWith('/admin/infrastruttura');
  const inSettings = (stripped.startsWith('/admin/settings') || stripped.startsWith('/admin/impostazioni'))
    && !inMonitoring;
  // Registrations area: attendee sign-ups, moderators, GDPR audit —
  // everything that has to do with the *people* on the platform.
  const inRegistrations = stripped.startsWith('/admin/registrations')
    || stripped.startsWith('/admin/iscrizioni')
    || stripped.startsWith('/admin/moderators')
    || stripped.startsWith('/admin/moderatori')
    || stripped.startsWith('/admin/gdpr-audit');
  const inRecordings = stripped.startsWith('/admin/recordings')
    || stripped.startsWith('/admin/registrazioni-video');
  const inPublications = stripped.startsWith('/admin/publications')
    || stripped.startsWith('/admin/pubblicazioni');

  const PATH_ALIASES: Record<string, string[]> = {
    '/admin/events': ['/admin/events', '/admin/eventi'],
    '/admin/events/new': ['/admin/events/new', '/admin/eventi/nuovo'],
    '/admin/events/calls': ['/admin/events/calls', '/admin/eventi/chiamate-rapide'],
    '/admin/events/template': ['/admin/events/template'],
    '/admin/events/statistics': ['/admin/events/statistics', '/admin/eventi/statistiche'],
    '/admin/calendar': ['/admin/calendar', '/admin/calendario'],
    '/admin/registrations': ['/admin/registrations', '/admin/iscrizioni'],
    '/admin/recordings': ['/admin/recordings', '/admin/registrazioni-video'],
    '/admin/publications': ['/admin/publications', '/admin/pubblicazioni'],
    '/admin/publications/new': ['/admin/publications/new', '/admin/pubblicazioni/nuova'],
    '/admin/moderators': ['/admin/moderators', '/admin/moderatori'],
    '/admin/gdpr-audit': ['/admin/gdpr-audit'],
    '/admin/settings': ['/admin/settings', '/admin/impostazioni'],
    '/admin/settings/languages': ['/admin/settings/languages', '/admin/impostazioni/lingue'],
    '/admin/settings/gdpr-templates': ['/admin/settings/gdpr-templates', '/admin/impostazioni/modelli-gdpr'],
    '/admin/infrastructure': ['/admin/infrastructure', '/admin/infrastruttura'],
    '/admin/monitoring': ['/admin/monitoring'],
  };

  function matchesPath(href: string, exact?: boolean): boolean {
    const aliases = PATH_ALIASES[href] || [href];
    if (exact) return aliases.some((a) => stripped === a);
    return aliases.some((a) => stripped.startsWith(a));
  }

  function isActive(item: NavItem): boolean {
    if (item.exact) return matchesPath(item.href, true);
    if (item.href === '/admin/events' && !item.exact) return inEvents;
    if (item.href === '/admin/monitoring') return inMonitoring;
    if (item.href === '/admin/settings') return inSettings;
    if (item.href === '/admin/registrations') return inRegistrations;
    if (item.href === '/admin/recordings') return inRecordings;
    if (item.href === '/admin/publications') return inPublications;
    return matchesPath(item.href);
  }

  function isSubActive(item: NavItem): boolean {
    if (item.exact) return matchesPath(item.href, true);
    return matchesPath(item.href);
  }

  const subNav = inEvents
    ? EVENTS_SUB_NAV
    : inRegistrations
      ? REGISTRATIONS_SUB_NAV
      : inRecordings
        ? RECORDINGS_SUB_NAV
        : inPublications
          ? PUBLICATIONS_SUB_NAV
          : inMonitoring
            ? MONITORING_SUB_NAV
            : inSettings
              ? SETTINGS_SUB_NAV
              : null;

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
