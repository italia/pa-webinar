// SPDX-License-Identifier: EUPL-1.2
// SPDX-FileCopyrightText: 2026 Dipartimento per la Trasformazione Digitale

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Icon } from '@/components/ui/icon';
import { useTendina } from '@/hooks/use-tendina';
import { Link, usePathname } from '@/i18n/navigation';

import {
  sezioneDi,
  sezioniPerRuolo,
  voceAttiva,
  type NavItem,
  type NavSection,
  type StaffRole,
} from './admin-nav-model';

/**
 * Da quante pagine in su una sezione apre un megamenu invece di una tendina:
 * il design system lo vuole «con parsimonia», per le sezioni ricche.
 */
export const VOCI_PER_MEGAMENU = 4;
/** Colonne del megamenu su schermi larghi, come nel modello (col-lg-4). */
const COLONNE = 3;
/** Da qui in su la barra e' intera e il pannello dei telefoni non c'e'. */
const DESKTOP = '(min-width: 992px)';

/**
 * Il menu dell'area di amministrazione: la fascia di navigazione dell'header
 * completo di Designers Italia (`it-header-navbar-wrapper` + `navbar` di
 * Bootstrap Italia), cosi' valgono i suoi stili e il suo comportamento sui
 * telefoni (hamburger e pannello laterale). Le sezioni con molte pagine
 * aprono un megamenu, le altre una tendina. La struttura e' in
 * admin-nav-model, la stessa delle briciole e dei titoli delle pagine.
 * Il comportamento di Bootstrap Italia (data-bs-toggle) non c'e': lo fanno
 * useTendina e lo stato del pannello, come per gli altri menu dell'header.
 */
export default function AdminNav({ role = 'admin' }: { role?: StaffRole }) {
  const t = useTranslations('admin.nav');
  // `usePathname` restituisce il percorso INTERNO — senza prefisso di lingua
  // e con i segnaposto (`/admin/events/[id]`).
  const pathname = usePathname();
  const sezioni = sezioniPerRuolo(role);
  const corrente = sezioneDi(pathname, role);
  const idMenu = useId();
  // Il pannello laterale dei telefoni; sopra i 992px il CSS lo mostra sempre.
  const [menuAperto, setMenuAperto] = useState(false);
  const pannello = useRef<HTMLDivElement>(null);
  const apriMenu = useRef<HTMLButtonElement>(null);
  const chiudiMenu = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenuAperto(false);
  }, [pathname]);

  // Se lo schermo si allarga col pannello aperto (rotazione, finestra
  // ridimensionata), il pannello non c'e' piu': si chiude, o il fuoco
  // resterebbe chiuso nella barra.
  useEffect(() => {
    if (!menuAperto) return;
    const mq = window.matchMedia(DESKTOP);
    if (mq.matches) {
      setMenuAperto(false);
      return;
    }
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMenuAperto(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [menuAperto]);

  // Il pannello dei telefoni e' una finestra: il fuoco ci entra, ci resta
  // (Tab gira dentro) ed Esc lo chiude riportando il fuoco all'hamburger.
  // Con una sezione aperta dentro il pannello, Esc chiude prima quella
  // (lo fa useTendina): un livello per volta.
  useEffect(() => {
    if (!menuAperto) return;
    chiudiMenu.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pannello.current?.querySelector('.dropdown-menu.show')) return;
        setMenuAperto(false);
        apriMenu.current?.focus();
        return;
      }
      if (e.key !== 'Tab' || !pannello.current) return;
      const fuochi = Array.from(
        pannello.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
      ).filter((el) => el.offsetParent !== null);
      const primo = fuochi[0];
      const ultimo = fuochi.at(-1);
      if (!primo || !ultimo) return;
      if (e.shiftKey && document.activeElement === primo) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primo.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuAperto]);

  const chiudiPannello = () => {
    setMenuAperto(false);
    apriMenu.current?.focus();
  };

  return (
    <div className="it-header-navbar-wrapper admin-navbar">
      {/* Il «vai al contenuto» del sito porta al menu: questo salta anche lui. */}
      <a className="visually-hidden-focusable admin-skip" href="#admin-content">
        {t('skipToPage')}
      </a>
      <div className="container-xxl">
        <div className="row">
          <div className="col-12">
            <nav className="navbar navbar-expand-lg has-megamenu" aria-label={t('ariaLabel')}>
              <button
                ref={apriMenu}
                className="custom-navbar-toggler"
                type="button"
                aria-controls={idMenu}
                aria-expanded={menuAperto}
                aria-label={t('openMenu')}
                onClick={() => setMenuAperto(true)}
              >
                <Icon icon="it-burger" />
              </button>
              <div
                ref={pannello}
                className={`navbar-collapsable${menuAperto ? ' expanded' : ''}`}
                id={idMenu}
                tabIndex={-1}
                style={menuAperto ? { display: 'block' } : undefined}
                // Aperto sui telefoni e' una finestra modale; sopra i 992px
                // e' la barra, e il pannello non si apre.
                role={menuAperto ? 'dialog' : undefined}
                aria-modal={menuAperto ? true : undefined}
                aria-label={menuAperto ? t('ariaLabel') : undefined}
              >
                <div
                  className="overlay"
                  style={menuAperto ? { display: 'block' } : undefined}
                  onClick={chiudiPannello}
                />
                <div className="close-div">
                  <button
                    ref={chiudiMenu}
                    className="btn close-menu"
                    type="button"
                    onClick={chiudiPannello}
                  >
                    <span className="visually-hidden">{t('closeMenu')}</span>
                    <Icon icon="it-close-big" />
                  </button>
                </div>
                <div className="menu-wrapper">
                  <ul className="navbar-nav">
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
              </div>
            </nav>
          </div>
        </div>
      </div>
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
  const idPulsante = useId();
  const idPannello = useId();
  // Si chiude quando si cambia pagina (anche con i tasti avanti e indietro).
  useEffect(() => {
    chiudi();
  }, [pathname, chiudi]);
  const etichetta = t(sezione.labelKey);
  const mega = sezione.voci.length >= VOCI_PER_MEGAMENU;

  const voce = (v: NavItem) => {
    const corrente = voceAttiva(pathname, v);
    // Nel megamenu la freccia distingue i link, come nel modello.
    const freccia = mega && (
      <Icon icon="it-arrow-right-triangle" size="sm" className="me-2" />
    );
    return (
      <li key={v.href}>
        <Link
          href={v.href}
          className={`list-item dropdown-item${corrente ? ' active' : ''}`}
          aria-current={corrente ? 'page' : undefined}
          onClick={chiudi}
        >
          {freccia}
          <span>{t(v.labelKey)}</span>
        </Link>
      </li>
    );
  };

  // Le pagine in colonne della griglia, riempite dall'alto in basso.
  const perColonna = Math.ceil(sezione.voci.length / COLONNE);
  const colonne = Array.from({ length: COLONNE }, (_, i) =>
    sezione.voci.slice(i * perColonna, (i + 1) * perColonna),
  ).filter((c) => c.length > 0);

  return (
    <li
      ref={contenitore}
      className={`nav-item dropdown${mega ? ' megamenu' : ''}${attiva ? ' active' : ''}`}
    >
      <button
        ref={pulsante}
        id={idPulsante}
        type="button"
        // Con la classe active il pulsante indica la sezione corrente.
        className={`nav-link dropdown-toggle px-lg-2 px-xl-3${attiva ? ' active' : ''}${aperta ? ' show' : ''}`}
        aria-expanded={aperta}
        aria-controls={idPannello}
        // La sezione dice dove ci si trova; la pagina la indica la voce.
        aria-current={attiva ? 'location' : undefined}
        onClick={() => setAperta(!aperta)}
      >
        <span>{etichetta}</span>
        <Icon icon="it-expand" size="xs" className="ms-1" />
      </button>
      <div
        className={`dropdown-menu${mega ? ' shadow-lg' : ''}${aperta ? ' show' : ''}`}
        id={idPannello}
        role="region"
        aria-labelledby={idPulsante}
      >
        {mega ? (
          // La variante base del modello: le pagine in tre colonne, senza
          // titolo (il nome della sezione e' il pulsante che lo apre).
          <div className="megamenu pb-5 pt-3 py-lg-0">
            <div className="row">
              {colonne.map((c, i) => (
                <div key={i} className="col-12 col-lg-4">
                  <div className="link-list-wrapper">
                    <ul className="link-list">{c.map(voce)}</ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="link-list-wrapper">
            <ul className="link-list">{sezione.voci.map(voce)}</ul>
          </div>
        )}
      </div>
    </li>
  );
}
