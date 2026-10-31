'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { Link, usePathname, type Href } from '@/i18n/navigation';
import { localeNames, type Locale } from '@/i18n/config';
import { useSettings } from '@/lib/settings-context';

export default function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const params = useParams();
  // La query va portata con se': un moderatore arrivato col link
  // `?token=…` che cambia lingua perderebbe il token e finirebbe al login
  // amministratore, che non puo' passare. Si legge dopo il montaggio
  // (`useSearchParams` costringerebbe ogni pagina a un confine di Suspense
  // solo per l'intestazione), e si rilegge a ogni cambio di pagina.
  const [query, setQuery] = useState<Record<string, string>>({});
  const chiavePagina = `${pathname}|${JSON.stringify(params)}`;
  useEffect(() => {
    setQuery(Object.fromEntries(new URLSearchParams(window.location.search)));
  }, [chiavePagina]);
  // Lo stesso contenuto nell'altra lingua: il percorso interno con i suoi
  // parametri, che il router traduce. Sostituire solo il prefisso produceva
  // `/en/eventi/…`, un indirizzo che esisteva solo grazie a una redirezione.
  const stessaPagina = {
    pathname,
    params,
    ...(Object.keys(query).length > 0 ? { query } : {}),
  } as unknown as Href;
  const settings = useSettings();
  const t = useTranslations('nav');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const availableLocales = (
    Array.isArray(settings.availableLocales)
      ? settings.availableLocales as string[]
      : ['it', 'en']
  ).filter((l): l is Locale => l in localeNames);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Esc chiude e riporta il focus sul pulsante: chi naviga da tastiera non
    // deve ritrovarsi col focus su un elenco sparito.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, handleClickOutside]);

  if (availableLocales.length <= 1) return null;

  // Il menu della lingua dello slim header di Designers Italia: un pulsante
  // con la lingua attiva e un elenco di link (non una casella di scelta: i
  // ruoli listbox/option prometterebbero una selezione con le frecce che qui
  // non esiste). Sempre lo stesso, con due lingue come con ventiquattro.
  return (
    <div ref={ref} className="nav-item dropdown lingua-menu">
      <button
        ref={buttonRef}
        type="button"
        className="nav-link dropdown-toggle d-inline-flex align-items-center gap-1 text-white"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={listId}
      >
        <span className="visually-hidden">{t('activeLanguage')}</span>
        <span className="text-uppercase fw-semibold" lang={currentLocale}>
          {currentLocale}
        </span>
        <span className="visually-hidden">{` (${localeNames[currentLocale]})`}</span>
        <Icon
          icon="it-expand"
          size="xs"
          color="white"
          className="d-none d-lg-block"
          style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s ease' }}
        />
      </button>
      <div className={`dropdown-menu lingua-menu__elenco${open ? ' show' : ''}`}>
        <div className="link-list-wrapper">
          <ul className="link-list" id={listId} aria-label={t('language')}>
            {availableLocales.map((loc) => (
              <li key={loc}>
                <Link
                  href={stessaPagina}
                  locale={loc}
                  className={`dropdown-item list-item${loc === currentLocale ? ' active' : ''}`}
                  lang={loc}
                  aria-current={loc === currentLocale ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                >
                  <span>
                    {localeNames[loc]}
                    {loc === currentLocale && <span className="visually-hidden"> {t('languageSelected')}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
