'use client';

import { useTranslations } from 'next-intl';

import AdminLogoutButton from '@/components/admin/admin-logout-button';
import { Icon } from '@/components/ui/icon';
import { Link, usePathname } from '@/i18n/navigation';

import { sezioneDi, sezioniPerRuolo, voceAttiva, type StaffRole } from './admin-nav-model';

/**
 * Il menu dell'area di amministrazione: le sezioni in alto, le voci della
 * sezione corrente sotto. La struttura e' in admin-nav-model, la stessa delle
 * briciole e dei titoli delle pagine.
 */
export default function AdminNav({ role = 'admin' }: { role?: StaffRole }) {
  const t = useTranslations('admin.nav');
  // `usePathname` restituisce il percorso INTERNO — senza prefisso di lingua
  // e con i segnaposto (`/admin/events/[id]`) — quindi le sezioni si
  // riconoscono una volta sola, in qualunque lingua sia l'indirizzo.
  const pathname = usePathname();
  const sezioni = sezioniPerRuolo(role);
  const corrente = sezioneDi(pathname, role);

  return (
    <div>
      {/* Il «vai al contenuto» del sito porta al menu: questo salta anche lui. */}
      <a className="visually-hidden-focusable admin-skip" href="#admin-content">
        {t('skipToPage')}
      </a>
      <nav className="admin-nav" aria-label={t('ariaLabel')}>
        <div className="container d-flex align-items-stretch">
          <ul className="nav flex-nowrap admin-nav__list">
            {sezioni.map((s) => {
              const attiva = corrente?.href === s.href;
              return (
                <li key={s.href} className="nav-item">
                  <Link
                    href={s.href}
                    className={`nav-link admin-nav__link${attiva ? ' admin-nav__link--active' : ''}`}
                    // La sezione dice dove ci si trova; la pagina la indica
                    // la voce del sotto-menu.
                    aria-current={attiva ? 'location' : undefined}
                    // Sui telefoni l'etichetta e' nascosta (`d-none` la toglie
                    // anche ai lettori di schermo): il nome lo porta l'attributo.
                    aria-label={t(s.labelKey)}
                    title={t(s.labelKey)}
                  >
                    <Icon icon={s.icon} size="sm" />
                    <span className="d-none d-xl-inline">{t(s.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* L'uscita sta qui, su ogni pagina e in fondo alla barra. */}
          <div className="ms-auto d-flex align-items-center ps-2">
            <AdminLogoutButton variant="nav" />
          </div>
        </div>
      </nav>

      {corrente && corrente.voci.length > 1 && (
        <nav className="admin-subnav" aria-label={t('subNavAriaLabel')}>
          <div className="container">
            <ul className="nav admin-nav__list">
              {corrente.voci.map((v) => {
                const attiva = voceAttiva(pathname, v);
                return (
                  <li key={v.href} className="nav-item">
                    <Link
                      href={v.href}
                      className={`nav-link admin-subnav__link${attiva ? ' admin-nav__link--active' : ''}`}
                      aria-current={attiva ? 'page' : undefined}
                      aria-label={t(v.labelKey)}
                      title={t(v.labelKey)}
                    >
                      <Icon icon={v.icon} size="xs" />
                      <span className="d-none d-sm-inline">{t(v.labelKey)}</span>
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
