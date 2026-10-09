'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Quanto manca alla fine, o di quanto la si è superata, e quando la sala si
 * chiude.
 *
 * Serve a chi conduce per regolare gli interventi mentre l'evento è in corso:
 * le durate delle statistiche arrivano dopo.
 *
 *  - Conta all'indietro, perché «quanto manca» è la domanda di chi presenta; un
 *    clic passa al tempo trascorso.
 *  - È acceso per chi conduce e spento per il pubblico: un orologio che scorre
 *    è una pressione che il pubblico non ha chiesto. La scelta resta salvata
 *    nel browser.
 *  - Oltre la fine continua a contare con «+», e l'icona cambia colore anche a
 *    contatore spento: è l'unico segnale del fuori orario nella sala. Il testo
 *    dell'icona dice quando la sala si chiude, e un annuncio per i lettori di
 *    schermo scatta all'inizio del fuori orario e negli ultimi dieci minuti.
 */
interface EventTimerProps {
  startsAt: string;
  endsAt: string;
  /** Tetto del fuori orario in minuti dopo `endsAt`; negativo = nessuno. */
  graceMinutes: number;
  /** Chi conduce lo trova acceso. */
  defaultVisible?: boolean;
}

/** Ultimi minuti prima della chiusura in cui l'icona avvisa in rosso. */
const CLOSING_SOON_MINUTES = 10;

function pad(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, '0');
}

/** `h:mm:ss` past an hour, `mm:ss` below it. */
function formatSpan(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const STORAGE_KEY = 'pawebinar.eventTimer';

type Fase = 'in-orario' | 'fuori-orario' | 'in-chiusura';

export default function EventTimer({
  startsAt,
  endsAt,
  graceMinutes,
  defaultVisible = false,
}: EventTimerProps) {
  const t = useTranslations('live.timer');
  const to = useTranslations('live.overtime');
  const [now, setNow] = useState<number | null>(null);
  const [visible, setVisible] = useState(defaultVisible);
  const [mode, setMode] = useState<'remaining' | 'elapsed'>('remaining');
  const [annuncio, setAnnuncio] = useState('');

  // `now` starts null and is only set on the client: rendering a clock during
  // SSR would hydrate with a stale value and mismatch.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { visible?: boolean; mode?: 'remaining' | 'elapsed' };
        if (typeof saved.visible === 'boolean') setVisible(saved.visible);
        if (saved.mode) setMode(saved.mode);
      }
    } catch { /* first visit, or storage blocked */ }
  }, []);

  const persist = useCallback((next: { visible: boolean; mode: 'remaining' | 'elapsed' }) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch { /* private mode: the choice just does not survive the tab */ }
  }, []);

  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const valid = now !== null && !Number.isNaN(start) && !Number.isNaN(end);
  const closeAt = graceMinutes >= 0 ? end + graceMinutes * 60_000 : null;
  const minutesToClose =
    valid && closeAt !== null ? Math.max(0, Math.ceil((closeAt - (now as number)) / 60_000)) : null;
  const fase: Fase =
    !valid || (now as number) < end
      ? 'in-orario'
      : minutesToClose !== null && minutesToClose <= CLOSING_SOON_MINUTES
        ? 'in-chiusura'
        : 'fuori-orario';

  // Cosa dice il fuori orario: quando chiude, o che resta aperta finché c'è
  // qualcuno.
  const messaggio =
    fase === 'in-orario'
      ? ''
      : minutesToClose === null
        ? to('indefinite')
        : minutesToClose > 0
          ? to('withCountdown', { minutes: minutesToClose })
          : to('closingNow');

  // L'annuncio cambia solo al cambio di fase: il conto dei minuti, letto a ogni
  // aggiornamento, renderebbe inutilizzabile un lettore di schermo.
  const [faseAnnunciata, setFaseAnnunciata] = useState<Fase>('in-orario');
  useEffect(() => {
    if (fase === faseAnnunciata) return;
    setFaseAnnunciata(fase);
    setAnnuncio(fase === 'in-orario' ? '' : messaggio);
  }, [fase, faseAnnunciata, messaggio]);

  if (!valid) return null;

  const remaining = end - (now as number);
  const elapsed = (now as number) - start;
  const label =
    mode === 'remaining'
      ? `${remaining < 0 ? '+' : ''}${formatSpan(remaining)}`
      : formatSpan(elapsed);

  const statoClasse =
    fase === 'in-chiusura' ? ' live-timer--closing' : fase === 'fuori-orario' ? ' live-timer--over' : '';

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    persist({ visible: next, mode });
  };
  const toggleMode = () => {
    const next = mode === 'remaining' ? 'elapsed' : 'remaining';
    setMode(next);
    persist({ visible, mode: next });
  };

  const annuncioNascosto = (
    <span className="visually-hidden" role="status">
      {annuncio}
    </span>
  );

  if (!visible) {
    const titolo = messaggio ? `${messaggio} ${t('show')}` : t('show');
    return (
      <>
        <button
          type="button"
          className={`live-timer live-timer--off${statoClasse}`}
          onClick={toggleVisible}
          aria-label={titolo}
          title={titolo}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
        </button>
        {annuncioNascosto}
      </>
    );
  }

  return (
    <span className={`live-timer${statoClasse}`} title={messaggio || undefined}>
      <button
        type="button"
        onClick={toggleMode}
        // aria-live off: a value that changes every second would make a screen
        // reader unusable. The label says what the number means; the number
        // itself is read on demand.
        aria-label={mode === 'remaining' ? t('remainingLabel') : t('elapsedLabel')}
        title={mode === 'remaining' ? t('remainingLabel') : t('elapsedLabel')}
      >
        {label}
      </button>
      <button type="button" onClick={toggleVisible} aria-label={t('hide')} title={t('hide')}>
        ×
      </button>
      {annuncioNascosto}
    </span>
  );
}
