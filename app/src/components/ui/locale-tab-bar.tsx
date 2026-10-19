'use client';

import { Badge } from 'design-react-kit';

import { localeNames, type Locale } from '@/i18n/config';

interface LocaleTabBarProps {
  enabledLocales: string[];
  defaultLocale: string;
  activeLocale: string;
  onSelectLocale: (locale: string) => void;
  filledLocales?: string[];
  /** Le lingue riempite dalla traduzione automatica, da rileggere: un terzo
   *  segno, diverso da quello delle lingue compilate. */
  machineLocales?: string[];
  /** Il nome accessibile di quel segno ("tradotto automaticamente, da
   *  rileggere"), nella lingua dell'interfaccia. */
  machineLabel?: string;
}

export default function LocaleTabBar({
  enabledLocales,
  defaultLocale,
  activeLocale,
  onSelectLocale,
  filledLocales,
  machineLocales,
  machineLabel,
}: LocaleTabBarProps) {
  return (
    <div
      className="d-flex flex-wrap gap-1 mb-3 p-1 rounded"
      style={{ backgroundColor: '#f0f0f0' }}
      role="tablist"
    >
      {enabledLocales.map((code) => {
        const isActive = code === activeLocale;
        const isDefault = code === defaultLocale;
        const isFilled = filledLocales?.includes(code);
        const isMachine = !isDefault && !!machineLabel && machineLocales?.includes(code);
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={isActive}
            className="btn btn-sm d-inline-flex align-items-center gap-1"
            style={{
              backgroundColor: isActive ? '#fff' : 'transparent',
              color: isActive ? '#0066CC' : '#5c6f82',
              border: isActive ? '1px solid #d9dadb' : '1px solid transparent',
              fontWeight: isActive ? 600 : 400,
              fontSize: '0.8rem',
              transition: 'all 0.15s ease',
              borderRadius: 4,
              padding: '4px 10px',
            }}
            onClick={() => onSelectLocale(code)}
          >
            {localeNames[code as Locale] ?? code}
            {isDefault && (
              <Badge
                color="primary"
                style={{ fontSize: '0.6rem', padding: '1px 4px' }}
              >
                *
              </Badge>
            )}
            {isMachine ? (
              <>
                {/* Un rombo ambra: tradotto in automatico, da rileggere. */}
                <span aria-hidden="true" title={machineLabel} style={{ color: '#A66300', fontSize: '0.7rem' }}>
                  ◆
                </span>
                <span className="visually-hidden">{`, ${machineLabel}`}</span>
              </>
            ) : (
              !isDefault &&
              isFilled && <span style={{ color: '#008758', fontSize: '0.65rem' }}>●</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
