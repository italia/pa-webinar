'use client';

import { useTranslations } from 'next-intl';

import { useParams } from 'next/navigation';

import { Link, usePathname, type Href } from '@/i18n/navigation';
import type { PercorsoInterno } from '@/i18n/percorsi';

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

// L'albero dell'amministrazione, per percorso interno (quello che
// restituisce `usePathname`: senza lingua, con i segnaposto). L'etichetta e'
// la chiave nello spazio `admin.nav`, la stessa del menu: le due non possono
// divergere.
const ETICHETTE: Partial<Record<PercorsoInterno, string>> = {
  '/admin': 'admin',
  '/admin/events': 'events',
  '/admin/events/new': 'newEvent',
  '/admin/events/calls': 'instantCalls',
  '/admin/events/template': 'templates',
  '/admin/events/statistics': 'analytics',
  '/admin/calendar': 'calendar',
  '/admin/events/[id]': 'eventDetail',
  '/admin/events/[id]/edit': 'eventEdit',
  '/admin/events/[id]/materials': 'eventMaterials',
  '/admin/events/[id]/questionnaires': 'eventQuestionnaires',
  '/admin/registrations': 'registrations',
  '/admin/moderators': 'moderators',
  '/admin/gdpr-audit': 'gdprAudit',
  '/admin/rubrica': 'rubrica',
  '/admin/rubrica/[id]': 'rubricaDetail',
  '/admin/recordings': 'recordings',
  '/admin/postprod': 'recordingsPostprod',
  '/admin/postprod/[recordingId]': 'postprodDetail',
  '/admin/publications': 'publications',
  '/admin/publications/new': 'publicationsNew',
  '/admin/questionnaires': 'questionnaires',
  '/admin/questionnaires/responses': 'questionnairesResponses',
  '/admin/questionnaires/feedback': 'feedbackDashboard',
  '/admin/monitoring': 'monitoring',
  '/admin/infrastructure': 'infrastructure',
  '/admin/settings': 'settings',
  '/admin/settings/languages': 'settingsLanguages',
  '/admin/settings/gdpr-templates': 'settingsGdprTemplates',
  '/admin/settings/email-templates': 'settingsEmailTemplates',
  '/admin/settings/tags': 'settingsTags',
};

interface Anello {
  labelKey: string;
  href: Href;
}

// Gli antenati sono i prefissi del percorso interno che l'albero conosce.
// Un antenato con segnaposto (il singolo evento, sopra la sua modifica) si
// riempie con i parametri dell'indirizzo corrente.
function ancestorChain(pathname: string, params: Record<string, string>): Anello[] {
  const segmenti = pathname.split('/').filter(Boolean);
  const catena: Anello[] = [];
  for (let i = 1; i <= segmenti.length; i += 1) {
    const prefisso = `/${segmenti.slice(0, i).join('/')}` as PercorsoInterno;
    const labelKey = ETICHETTE[prefisso];
    if (!labelKey) continue;
    const nomi = [...prefisso.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1] ?? '');
    const href = (
      nomi.length === 0
        ? prefisso
        : { pathname: prefisso, params: Object.fromEntries(nomi.map((n) => [n, params[n] ?? ''])) }
    ) as Href;
    catena.push({ labelKey, href });
  }
  return catena;
}

export default function AdminBreadcrumb() {
  const pathname = usePathname();
  const params = useParams<Record<string, string>>();
  const t = useTranslations('admin.nav');

  // La radice non ha bisogno di briciole: ci si e' gia', e il menu sopra
  // basta a orientarsi.
  if (pathname === '/admin' || pathname === '/admin/login') return null;

  const chain = ancestorChain(pathname, params ?? {});
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
        {parent && (
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
                {isLast ? (
                  <span style={{ color: 'var(--app-muted)' }}>{t(c.labelKey)}</span>
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
