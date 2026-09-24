'use client';

import { useTranslations } from 'next-intl';

import AdminLogoutButton from '@/components/admin/admin-logout-button';
import { Icon } from '@/components/ui/icon';
import { Link, usePathname } from '@/i18n/navigation';
import type { PercorsoStatico } from '@/i18n/percorsi';

interface NavItem {
  href: PercorsoStatico;
  icon: string;
  labelKey: string;
  exact?: boolean;
}

const MAIN_SECTIONS: NavItem[] = [
  { href: '/admin/events', icon: 'it-calendar', labelKey: 'events' },
  { href: '/admin/registrations', icon: 'it-user', labelKey: 'registrations' },
  { href: '/admin/questionnaires', icon: 'it-help-circle', labelKey: 'questionnaires' },
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
  {
    href: '/admin/registrations',
    icon: 'it-user',
    labelKey: 'registrationsList',
    exact: true,
  },
  { href: '/admin/rubrica', icon: 'it-pa', labelKey: 'rubrica' },
  { href: '/admin/moderators', icon: 'it-key', labelKey: 'moderators' },
  { href: '/admin/gdpr-audit', icon: 'it-files', labelKey: 'gdprAudit' },
];

// Recordings / instant calls / live sessions — everything video-output.
const RECORDINGS_SUB_NAV: NavItem[] = [
  {
    href: '/admin/recordings',
    icon: 'it-video',
    labelKey: 'recordingsList',
    exact: true,
  },
  // Gestione post-produzione AI delle registrazioni (trascrizione,
  // traduzione, speaker, editor, re-run). Vive sotto "Registrazioni"
  // perché opera SULLE registrazioni — non è configurazione (quella sta
  // in Impostazioni → Pipeline AI).
  { href: '/admin/postprod', icon: 'it-comment', labelKey: 'recordingsPostprod' },
];

// Publications area: unified library editing.
const PUBLICATIONS_SUB_NAV: NavItem[] = [
  {
    href: '/admin/publications',
    icon: 'it-files',
    labelKey: 'publicationsList',
    exact: true,
  },
  { href: '/admin/publications/new', icon: 'it-plus', labelKey: 'publicationsNew' },
];

// Monitoring groups together all the observability surfaces.
const MONITORING_SUB_NAV: NavItem[] = [
  {
    href: '/admin/monitoring',
    icon: 'it-presentation',
    labelKey: 'monitoringDashboard',
    exact: true,
  },
  { href: '/admin/infrastructure', icon: 'it-server', labelKey: 'infrastructure' },
];

const SETTINGS_SUB_NAV: NavItem[] = [
  {
    href: '/admin/settings',
    icon: 'it-settings',
    labelKey: 'settingsGeneral',
    exact: true,
  },
  {
    href: '/admin/settings/languages',
    icon: 'it-hearing',
    labelKey: 'settingsLanguages',
  },
  {
    href: '/admin/settings/gdpr-templates',
    icon: 'it-lock',
    labelKey: 'settingsGdprTemplates',
  },
  {
    href: '/admin/settings/email-templates',
    icon: 'it-mail',
    labelKey: 'settingsEmailTemplates',
  },
  { href: '/admin/settings/tags', icon: 'it-bookmark', labelKey: 'settingsTags' },
];

const QUESTIONNAIRES_SUB_NAV: NavItem[] = [
  {
    href: '/admin/questionnaires',
    icon: 'it-copy',
    labelKey: 'questionnairesLibrary',
    exact: true,
  },
  {
    href: '/admin/questionnaires/responses',
    icon: 'it-chart-line',
    labelKey: 'questionnairesResponses',
  },
  {
    href: '/admin/questionnaires/feedback',
    icon: 'it-star-outline',
    labelKey: 'feedbackDashboard',
  },
];

export default function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();

  // `usePathname` restituisce il percorso INTERNO — senza prefisso di lingua
  // e con i segnaposto (`/admin/events/[id]`) — quindi le sezioni si
  // riconoscono una volta sola, in qualunque lingua sia l'indirizzo.
  const sotto = (...radici: string[]) =>
    radici.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  const inEvents = sotto('/admin/events', '/admin/calendar');
  // Monitoraggio e infrastruttura sono viste operative, non configurazione:
  // hanno una sezione loro.
  const inMonitoring = sotto('/admin/monitoring', '/admin/infrastructure');
  const inSettings = sotto('/admin/settings');
  // Le persone: iscrizioni, rubrica, moderatori, registro GDPR.
  const inRegistrations = sotto(
    '/admin/registrations',
    '/admin/rubrica',
    '/admin/moderators',
    '/admin/gdpr-audit',
  );
  const inRecordings = sotto('/admin/recordings', '/admin/postprod');
  const inPublications = sotto('/admin/publications');
  const inQuestionnaires = sotto('/admin/questionnaires');

  function matchesPath(href: string, exact?: boolean): boolean {
    return exact ? pathname === href : sotto(href);
  }

  function isActive(item: NavItem): boolean {
    if (item.exact) return matchesPath(item.href, true);
    if (item.href === '/admin/events' && !item.exact) return inEvents;
    if (item.href === '/admin/monitoring') return inMonitoring;
    if (item.href === '/admin/settings') return inSettings;
    if (item.href === '/admin/registrations') return inRegistrations;
    if (item.href === '/admin/recordings') return inRecordings;
    if (item.href === '/admin/publications') return inPublications;
    if (item.href === '/admin/questionnaires') return inQuestionnaires;
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
              : inQuestionnaires
                ? QUESTIONNAIRES_SUB_NAV
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
                    // Sui telefoni l'etichetta e' nascosta (`d-none` la toglie
                    // anche ai lettori di schermo): il nome del link lo porta
                    // l'attributo, altrimenti resterebbe un'icona muta.
                    aria-label={t(item.labelKey)}
                  >
                    <Icon icon={item.icon} size="sm" />
                    <span className="d-none d-sm-inline">{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
            {/* L'uscita sta qui, su ogni pagina e in fondo alla barra: era
                solo in due pagine, e accanto all'azione principale. */}
            <li className="nav-item ms-auto d-flex align-items-center">
              <AdminLogoutButton variant="nav" />
            </li>
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
                      aria-label={t(item.labelKey)}
                    >
                      <Icon icon={item.icon} size="xs" />
                      <span className="d-none d-sm-inline">{t(item.labelKey)}</span>
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
