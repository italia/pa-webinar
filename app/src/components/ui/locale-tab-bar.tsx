'use client';

/**
 * Le schede delle lingue di un testo multilingue (il titolo e la descrizione
 * di un evento, il motto del sito).
 *
 * E' il modello delle schede: le frecce, Inizio e Fine spostano la scheda
 * scelta, una sola scheda e' raggiungibile con Tab, e con `panelId` ogni
 * scheda indica il pannello che governa. Con `stati` ogni scheda dice sotto il
 * nome, a parole e con un'icona, lo stato del testo in quella lingua; senza,
 * un asterisco segna la lingua predefinita e un punto quelle compilate.
 */
import { useRef, type KeyboardEvent } from 'react';
import { Badge } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { localeNames, type Locale } from '@/i18n/config';

/** Lo stato scritto sotto il nome di una lingua. */
export interface StatoScheda {
  testo: string;
  /** Un'icona dello sprite (`it-check-circle`). */
  icona: string;
  tono: 'neutro' | 'info' | 'successo' | 'avviso' | 'errore';
}

interface LocaleTabBarProps {
  enabledLocales: string[];
  defaultLocale: string;
  activeLocale: string;
  onSelectLocale: (locale: string) => void;
  filledLocales?: string[];
  /** Il nome della barra per le tecnologie assistive. */
  ariaLabel?: string;
  /** L'id del pannello (role=tabpanel) che le schede governano. */
  panelId?: string;
  /** Il prefisso degli id delle schede: `${idPrefix}-${codice}`. */
  idPrefix?: string;
  /** Lo stato del testo in ogni lingua, scritto sotto il nome. */
  stati?: Record<string, StatoScheda>;
}

export default function LocaleTabBar({
  enabledLocales,
  defaultLocale,
  activeLocale,
  onSelectLocale,
  filledLocales,
  ariaLabel,
  panelId,
  idPrefix,
  stati,
}: LocaleTabBarProps) {
  const schede = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Una lingua attiva che non e' fra le schede (tolta dall'elenco): la
  // raggiungibile con Tab resta la prima.
  const attiva = enabledLocales.includes(activeLocale) ? activeLocale : enabledLocales[0];

  const vaiA = (codice: string | undefined) => {
    if (!codice) return;
    onSelectLocale(codice);
    schede.current.get(codice)?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = enabledLocales.length;
    const dove: Record<string, number> = {
      ArrowRight: (i + 1) % n,
      ArrowLeft: (i - 1 + n) % n,
      Home: 0,
      End: n - 1,
    };
    if (!(e.key in dove)) return;
    e.preventDefault();
    vaiA(enabledLocales[dove[e.key]!]);
  };

  return (
    <div
      className={`schede-lingua d-flex flex-wrap gap-1 mb-3 p-1 rounded${stati ? ' schede-lingua--stati' : ''}`}
      style={{ backgroundColor: '#f0f0f0' }}
      role="tablist"
      aria-label={ariaLabel}
    >
      {enabledLocales.map((code, i) => {
        const isActive = code === attiva;
        const isDefault = code === defaultLocale;
        const isFilled = filledLocales?.includes(code);
        const stato = stati?.[code];
        return (
          <button
            key={code}
            ref={(el) => {
              if (el) schede.current.set(code, el);
              else schede.current.delete(code);
            }}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-${code}` : undefined}
            aria-selected={isActive}
            aria-controls={panelId}
            tabIndex={isActive ? 0 : -1}
            className={
              stato
                ? 'btn btn-sm schede-lingua__scheda'
                : 'btn btn-sm d-inline-flex align-items-center gap-1'
            }
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
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className="schede-lingua__nome" lang={code}>
              {localeNames[code as Locale] ?? code}
            </span>
            {stato ? (
              <span className={`schede-lingua__stato schede-lingua__stato--${stato.tono}`}>
                <Icon icon={stato.icona} size="xs" className="schede-lingua__icona" />
                {/* Il nome accessibile: «English, automatica». */}
                <span className="visually-hidden">, </span>
                {stato.testo}
              </span>
            ) : (
              <>
                {isDefault && (
                  <Badge color="primary" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>
                    *
                  </Badge>
                )}
                {!isDefault && isFilled && (
                  <span style={{ color: '#008758', fontSize: '0.65rem' }}>●</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
