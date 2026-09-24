'use client';

import { useState, useRef, useEffect, useCallback, useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';

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

  if (availableLocales.length <= 4) {
    return (
      // La lingua non attiva e' bianca piena come l'altra: un'opacita' ridotta
      // sulla fascia blu scendeva sotto il contrasto minimo, proprio sul
      // comando che serve a chi non legge la lingua corrente. La differenza
      // la fanno il peso e la sottolineatura, non la trasparenza.
      <ul
        className="d-flex list-unstyled mb-0 align-items-center"
        aria-label={t('language')}
      >
        {availableLocales.map((loc, idx) => (
          <li key={loc} className="d-flex align-items-center">
            {idx > 0 && (
              <span className="text-white mx-1" aria-hidden="true">
                |
              </span>
            )}
            {loc === currentLocale ? (
              <span
                className="text-white fw-bold text-uppercase"
                style={{
                  fontSize: '0.85rem',
                  letterSpacing: '0.02em',
                  borderBottom: '2px solid currentColor',
                }}
                aria-current="true"
              >
                {loc}
              </span>
            ) : (
              <Link
                href={stessaPagina}
                locale={loc}
                className="text-white text-uppercase text-decoration-none"
                style={{ fontSize: '0.85rem', letterSpacing: '0.02em' }}
                lang={loc}
              >
                {loc}
              </Link>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div ref={ref} className="position-relative">
      {/* Un pulsante che apre un elenco di link, non una casella di scelta:
          i ruoli listbox/option promettevano una selezione con le frecce che
          qui non esiste. */}
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-sm text-white d-inline-flex align-items-center gap-1 border-0"
        style={{ fontSize: '0.85rem', background: 'transparent' }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${t('switchLanguage')}: ${localeNames[currentLocale]}`}
      >
        <span className="text-uppercase fw-semibold">{currentLocale}</span>
        <span style={{ fontSize: '0.75rem' }}>{localeNames[currentLocale]}</span>
        <svg
          aria-hidden="true"
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="currentColor"
          style={{
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.15s ease',
          }}
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          className="position-absolute list-unstyled py-2 shadow-lg rounded"
          style={{
            right: 0,
            top: '100%',
            marginTop: 4,
            backgroundColor: '#fff',
            minWidth: 180,
            maxHeight: 320,
            overflowY: 'auto',
            zIndex: 1050,
            border: '1px solid #d9dadb',
          }}
        >
          {availableLocales.map((loc) => (
            <li key={loc}>
              <Link
                href={stessaPagina}
                locale={loc}
                className="d-flex align-items-center gap-2 px-3 py-2 text-decoration-none"
                style={{
                  color: loc === currentLocale ? '#0066CC' : 'var(--app-text)',
                  backgroundColor: loc === currentLocale ? '#f0f7ff' : 'transparent',
                  fontSize: '0.85rem',
                }}
                lang={loc}
                aria-current={loc === currentLocale ? 'true' : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="text-uppercase fw-semibold" style={{ minWidth: 22 }}>
                  {loc}
                </span>
                <span>{localeNames[loc]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
