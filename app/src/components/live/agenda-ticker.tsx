'use client';

/**
 * L'argomento in corso, nella barra della sala.
 *
 * Chi segue la chiamata e scrive in chat non apre l'agenda: qui vede a che
 * punto si e' senza cambiare pannello. Una pastiglia con l'argomento in corso
 * e l'avanzamento; passandoci sopra, o con un clic, si apre l'elenco completo
 * con lo stato di ogni argomento.
 *
 * Legge la versione leggera dell'agenda (`?lite=1`: titoli e stati, uguale
 * per tutti e tenuta in caldo qualche secondo sul server). La chiave comincia
 * con l'indirizzo dell'agenda, cosi' gli avvisi del canale la fanno
 * rileggere subito: anche quelli dei 👍, che qui costano una lettura in caldo.
 * Il giro lento resta per quando il canale non c'e' e per accorgersi della
 * agenda accesa durante l'evento.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { useNow, useTranslations } from 'next-intl';

import { useLivePush } from '@/hooks/use-live-state';
import type { AgendaStatus } from '@/lib/agenda/status';

import AgendaStatusLine from './agenda-status-line';

interface TickerItem {
  id: string;
  label: string;
  status: AgendaStatus;
  startedAt: string | null;
  completedAt: string | null;
  plannedMinutes: number | null;
}

interface TickerResponse {
  agendaEnabled: boolean;
  items: TickerItem[];
}

/** Quanto aspettare prima di aprire e di chiudere col solo passaggio del mouse. */
const APRI_MS = 150;
const CHIUDI_MS = 350;
/** Distanza minima dal bordo della finestra. */
const MARGINE_PX = 12;

export default function AgendaTicker({
  eventSlug,
  isModerator,
}: {
  eventSlug: string;
  /** Chi conduce vede i tempi rispetto al previsto. */
  isModerator: boolean;
}) {
  const t = useTranslations('agenda');
  const now = useNow({ updateInterval: 30_000 });
  const listId = useId();
  const pushLive = useLivePush();
  const { data } = useSWR<TickerResponse>(
    [`/api/events/${eventSlug}/agenda?lite=1`, 'ticker'],
    ([url]: [string, string]) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    {
      // Col canale il giro serve da rete: un'altra istanza dell'app puo'
      // rispondere all'avviso con lo stato di un attimo prima.
      refreshInterval: (d) => (pushLive ? 15_000 : d?.agendaEnabled ? 10_000 : 30_000),
      revalidateOnFocus: false,
    },
  );

  // Aperto col mouse (si chiude uscendo) o fissato con un clic (si chiude con
  // un altro clic, con Esc o cliccando altrove).
  const [aperto, setAperto] = useState(false);
  const [fissato, setFissato] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Sul telefono la pastiglia sta a meta' barra: l'elenco si sposta a sinistra
  // quanto basta per restare dentro lo schermo.
  const [spostamento, setSpostamento] = useState(0);
  useLayoutEffect(() => {
    if (!aperto) {
      setSpostamento(0);
      return;
    }
    const r = popRef.current?.getBoundingClientRect();
    if (!r) return;
    const fuori = r.right - (window.innerWidth - MARGINE_PX);
    if (fuori > 0) setSpostamento(-Math.min(fuori, Math.max(0, r.left - MARGINE_PX)));
  }, [aperto]);

  const programma = useCallback((fn: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(fn, ms);
  }, []);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!aperto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAperto(false);
        setFissato(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setAperto(false);
        setFissato(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [aperto]);

  const items = data?.items ?? [];
  if (!data?.agendaEnabled || items.length === 0) return null;

  const current = items.find((i) => i.status === 'CURRENT') ?? null;
  const done = items.filter((i) => i.status === 'DONE').length;

  return (
    <div
      className="agenda-ticker"
      ref={wrapRef}
      onMouseEnter={() => programma(() => setAperto(true), APRI_MS)}
      onMouseLeave={() => {
        if (!fissato) programma(() => setAperto(false), CHIUDI_MS);
      }}
    >
      <button
        type="button"
        className={`agenda-ticker__pill${current ? ' is-live' : ''}`}
        aria-expanded={aperto}
        aria-controls={listId}
        onClick={() => {
          const apri = !(aperto && fissato);
          setAperto(apri);
          setFissato(apri);
        }}
      >
        {current ? (
          <>
            <span className="agenda-ticker__dot" aria-hidden="true" />
            <span className="agenda-ticker__kicker">{t('tickerNow')}</span>
            <span className="agenda-ticker__label">{current.label}</span>
          </>
        ) : (
          <span className="agenda-ticker__label">{t('title')}</span>
        )}
        <span className="agenda-ticker__count">
          {done}/{items.length}
        </span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="agenda-ticker__chevron">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {aperto && (
        <div
          className="agenda-ticker__pop"
          id={listId}
          ref={popRef}
          role="region"
          aria-label={t('title')}
          style={spostamento ? { transform: `translateX(${spostamento}px)` } : undefined}
        >
          <p className="agenda-ticker__title">
            {t('title')} · {t('progress', { done, total: items.length })}
          </p>
          <ol className="agenda-ticker__list">
            {items.map((item, idx) => (
              <li key={item.id} className={`agenda-ticker__row agenda-item--${item.status.toLowerCase()}`}>
                <span className="agenda-item__marker" aria-hidden="true">
                  {item.status === 'DONE' ? '✓' : item.status === 'SKIPPED' ? '→' : item.status === 'CURRENT' ? (
                    <span className="agenda-item__pulse" />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span className="agenda-ticker__row-body">
                  <span className="agenda-item__label">{item.label}</span>
                  <AgendaStatusLine item={item} now={now} isModerator={isModerator} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
