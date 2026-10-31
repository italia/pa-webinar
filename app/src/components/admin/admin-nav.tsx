'use client';

import { useEffect, useId } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useTendina } from '@/hooks/use-tendina';
import { Link, usePathname } from '@/i18n/navigation';

import {
  sezioneDi,
  sezioniPerRuolo,
  voceAttiva,
  type NavSection,
  type StaffRole,
} from './admin-nav-model';

/**
 * Il menu dell'area di amministrazione: una barra con le sezioni, e per ogni
 * sezione un megamenu con le sue pagine, come nell'header completo dei
 * modelli di Designers Italia (niente schede sotto la barra). La struttura e'
 * in admin-nav-model, la stessa delle briciole e dei titoli delle pagine;
 * l'uscita sta nell'area utente, in alto.
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
        <div className="container admin-nav__contenitore">
          <ul className="nav admin-nav__list">
            {sezioni.map((s) => (
              <Sezione
                key={s.href}
                sezione={s}
                attiva={corrente?.href === s.href}
                pathname={pathname}
              />
            ))}
          </ul>
        </div>
      </nav>
    </div>
  );
}

function Sezione({
  sezione,
  attiva,
  pathname,
}: {
  sezione: NavSection;
  attiva: boolean;
  pathname: string;
}) {
  const t = useTranslations('admin.nav');
  const { aperta, setAperta, chiudi, contenitore, pulsante } = useTendina<HTMLLIElement>();
  const id = useId();
  // Si chiude quando si cambia pagina (anche con i tasti avanti e indietro).
  useEffect(() => {
    chiudi();
  }, [pathname, chiudi]);
  const etichetta = t(sezione.labelKey);

  return (
    <li ref={contenitore} className="nav-item dropdown megamenu admin-nav__sezione">
      <button
        ref={pulsante}
        type="button"
        className={`nav-link dropdown-toggle admin-nav__link${attiva ? ' admin-nav__link--active' : ''}`}
        aria-expanded={aperta}
        aria-controls={id}
        // La sezione dice dove ci si trova; la pagina la indica la voce.
        aria-current={attiva ? 'location' : undefined}
        title={etichetta}
        onClick={() => setAperta(!aperta)}
      >
        <Icon icon={sezione.icon} size="sm" />
        {/* Sui telefoni resta l'icona; il nome lo legge chi usa un lettore
            di schermo. */}
        <span className="d-none d-xl-inline">{etichetta}</span>
        <span className="visually-hidden d-xl-none">{etichetta}</span>
        <Icon
          icon="it-expand"
          size="xs"
          className="admin-nav__freccia"
          style={{ transform: aperta ? 'rotate(180deg)' : undefined }}
        />
      </button>
      <div className={`dropdown-menu admin-mega${aperta ? ' show' : ''}`} id={id}>
        <div className="megamenu">
          <p className="admin-mega__titolo" aria-hidden="true">
            <Icon icon={sezione.icon} size="sm" className="me-2" />
            {etichetta}
          </p>
          <div className="link-list-wrapper">
            <ul className="link-list admin-mega__voci">
              {sezione.voci.map((v) => {
                const corrente = voceAttiva(pathname, v);
                return (
                  <li key={v.href}>
                    <Link
                      href={v.href}
                      className={`dropdown-item list-item${corrente ? ' active' : ''}`}
                      aria-current={corrente ? 'page' : undefined}
                      onClick={chiudi}
                    >
                      <Icon icon={v.icon} size="sm" className="me-2" />
                      <span>{t(v.labelKey)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </li>
  );
}
