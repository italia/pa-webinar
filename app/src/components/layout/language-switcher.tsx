'use client';

import { useLocale } from 'next-intl';

import { Link, usePathname } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/config';

export default function LanguageSwitcher() {
  const currentLocale = useLocale() as Locale;
  const pathname = usePathname();

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
