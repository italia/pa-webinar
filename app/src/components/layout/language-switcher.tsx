'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocale } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { localeNames, type Locale } from '@/i18n/config';
import { useSettings } from '@/lib/settings-context';

export default function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, handleClickOutside]);

  if (availableLocales.length <= 1) return null;

  if (availableLocales.length <= 4) {
    return (
      <ul className="d-flex list-unstyled mb-0 align-items-center">
        {availableLocales.map((loc, idx) => (
          <li key={loc} className="d-flex align-items-center">
            {idx > 0 && (
              <span
                className="text-white mx-1"
                style={{ opacity: 0.4 }}
                aria-hidden="true"
              >
                |
              </span>
            )}
            {loc === currentLocale ? (
              <span
                className="text-white fw-semibold text-uppercase"
                style={{ fontSize: '0.85rem', letterSpacing: '0.02em' }}
                aria-current="true"
              >
                {loc}
              </span>
            ) : (
              <Link
                href={pathname}
                locale={loc}
                className="text-white text-uppercase text-decoration-none"
                style={{ fontSize: '0.85rem', letterSpacing: '0.02em', opacity: 0.65 }}
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
      <button
        type="button"
        className="btn btn-sm text-white d-inline-flex align-items-center gap-1 border-0"
        style={{ fontSize: '0.85rem', background: 'transparent' }}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="text-uppercase fw-semibold">{currentLocale}</span>
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>
          {localeNames[currentLocale]}
        </span>
        <svg
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
          className="position-absolute list-unstyled py-2 shadow-lg rounded"
          role="listbox"
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
            <li key={loc} role="option" aria-selected={loc === currentLocale}>
              <Link
                href={pathname}
                locale={loc}
                className="d-flex align-items-center gap-2 px-3 py-2 text-decoration-none"
                style={{
                  color: loc === currentLocale ? '#0066CC' : 'var(--app-text)',
                  backgroundColor: loc === currentLocale ? '#f0f7ff' : 'transparent',
                  fontSize: '0.85rem',
                }}
                lang={loc}
                onClick={() => setOpen(false)}
              >
                <span className="text-uppercase fw-semibold" style={{ minWidth: 22 }}>
                  {loc}
                </span>
                <span style={{ opacity: 0.8 }}>{localeNames[loc]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
