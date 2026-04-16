'use client';

import { useTranslations } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';

// Inline SVG instead of <Icon> to avoid design-react-kit's async icon
// cache triggering hydration mismatches on a component rendered by the
// admin layout on every page.
function ChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

// Admin route tree. Ordered parent → child. Dynamic segments like
// `[id]` are matched as UUIDs. The label is the i18n key inside the
// `admin.nav` namespace (same table used by AdminNav). This keeps
// breadcrumb labels and nav labels in sync without a second glossary.
const ROUTE_TREE: { match: RegExp; labelKey: string; href: string }[] = [
  { match: /^\/admin$/, labelKey: 'admin', href: '/admin' },
  { match: /^\/admin\/events$/, labelKey: 'events', href: '/admin/events' },
  { match: /^\/admin\/events\/new$/, labelKey: 'newEvent', href: '/admin/events/new' },
  { match: /^\/admin\/events\/calls$/, labelKey: 'instantCalls', href: '/admin/events/calls' },
  { match: /^\/admin\/events\/template$/, labelKey: 'templates', href: '/admin/events/template' },
  { match: /^\/admin\/events\/statistics$/, labelKey: 'analytics', href: '/admin/events/statistics' },
  { match: /^\/admin\/calendar$/, labelKey: 'calendar', href: '/admin/calendar' },
  { match: /^\/admin\/events\/[0-9a-f-]{36}$/, labelKey: 'eventDetail', href: '' },
  { match: /^\/admin\/events\/[0-9a-f-]{36}\/edit$/, labelKey: 'eventEdit', href: '' },
  { match: /^\/admin\/registrations$/, labelKey: 'registrations', href: '/admin/registrations' },
  { match: /^\/admin\/moderators$/, labelKey: 'moderators', href: '/admin/moderators' },
  { match: /^\/admin\/gdpr-audit$/, labelKey: 'gdprAudit', href: '/admin/gdpr-audit' },
  { match: /^\/admin\/recordings$/, labelKey: 'recordings', href: '/admin/recordings' },
  { match: /^\/admin\/monitoring$/, labelKey: 'monitoring', href: '/admin/monitoring' },
  { match: /^\/admin\/infrastructure$/, labelKey: 'infrastructure', href: '/admin/infrastructure' },
  { match: /^\/admin\/settings$/, labelKey: 'settings', href: '/admin/settings' },
  { match: /^\/admin\/settings\/languages$/, labelKey: 'settingsLanguages', href: '/admin/settings/languages' },
  { match: /^\/admin\/settings\/gdpr-templates$/, labelKey: 'settingsGdprTemplates', href: '/admin/settings/gdpr-templates' },
];

// For each matched route, the chain of ancestor routes (by prefix) we
// want to surface as breadcrumb parents. Computed lazily from the full
// tree so renaming/adding routes needs one edit.
function ancestorChain(pathname: string): { labelKey: string; href: string }[] {
  const normalized = pathname.replace(/\/$/, '');
  const segments = normalized.split('/').filter(Boolean);
  const chain: { labelKey: string; href: string }[] = [];
  for (let i = 1; i <= segments.length; i += 1) {
    const path = `/${segments.slice(0, i).join('/')}`;
    const match = ROUTE_TREE.find((r) => r.match.test(path));
    if (match) {
      chain.push({ labelKey: match.labelKey, href: match.href || path });
    }
  }
  return chain;
}

export default function AdminBreadcrumb() {
  const pathname = usePathname();
  const t = useTranslations('admin.nav');

  // Strip the locale prefix (/it/admin/... or /en/admin/...) to match the
  // patterns in ROUTE_TREE, which are locale-agnostic.
  const stripped = pathname.replace(/^\/[a-z]{2}/, '');

  // The admin landing page doesn't need a breadcrumb — the user is
  // already at the tree root and the top nav is self-explanatory.
  if (stripped === '/admin' || stripped === '/admin/login') return null;

  const chain = ancestorChain(stripped);
  if (chain.length < 2) return null;

  const parent = chain[chain.length - 2];

  return (
    <nav
      aria-label="breadcrumb"
      style={{
        background: '#f8f9fa',
        borderBottom: '1px solid #e8e8e8',
        padding: '8px 0',
      }}
    >
      <div className="container d-flex align-items-center gap-2 flex-wrap">
        {parent?.href && (
          <Link
            href={parent.href}
            className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center gap-1"
            style={{ fontSize: '0.78rem' }}
          >
            <ChevronLeft />
            {t(parent.labelKey)}
          </Link>
        )}
        <ol
          className="breadcrumb mb-0"
          style={{ fontSize: '0.82rem', background: 'transparent', padding: 0 }}
        >
          {chain.map((c, i) => {
            const isLast = i === chain.length - 1;
            return (
              <li
                key={`${c.labelKey}-${i}`}
                className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                aria-current={isLast ? 'page' : undefined}
              >
                {isLast || !c.href ? (
                  <span style={{ color: '#5A768A' }}>{t(c.labelKey)}</span>
                ) : (
                  <Link href={c.href} className="text-decoration-none">
                    {t(c.labelKey)}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
