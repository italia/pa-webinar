'use client';

import { Suspense } from 'react';
import { useLocale } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';

import { locales, type Locale } from '@/i18n/config';

function LanguageSwitcherInner() {
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function buildUrl(targetLocale: Locale): string {
    const segments = pathname.split('/');
    if (locales.includes(segments[1] as Locale)) {
      segments[1] = targetLocale;
    }
    const newPath = segments.join('/');
    const qs = searchParams.toString();
    return qs ? `${newPath}?${qs}` : newPath;
  }

  return (
    <ul className="d-flex list-unstyled mb-0 align-items-center">
      {locales.map((loc, idx) => (
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
            <a
              href={buildUrl(loc)}
              className="text-white text-uppercase text-decoration-none"
              style={{ fontSize: '0.85rem', letterSpacing: '0.02em', opacity: 0.65 }}
              lang={loc}
            >
              {loc}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function LanguageSwitcher() {
  return (
    <Suspense
      fallback={
        <span
          className="text-white text-uppercase"
          style={{ fontSize: '0.85rem' }}
        >
          …
        </span>
      }
    >
      <LanguageSwitcherInner />
    </Suspense>
  );
}
