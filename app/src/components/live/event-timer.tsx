'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/**
 * How long is left — or how long we are over.
 *
 * Asked for during a call, by someone running it: "si può immaginare un
 * contatore dei minuti a fine del meeting o viceversa da quanto tempo è live?
 * L'obiettivo è regolare al meglio i vari interventi". The post-event analytics
 * already show durations, but that is no help while you are deciding whether to
 * take one more question.
 *
 * Two deliberate choices:
 *  - It counts DOWN by default, because "how much is left" is the question a
 *    presenter actually has; a click swaps to elapsed for anyone who prefers it.
 *  - It is off by default for the audience and on for whoever is running the
 *    room. A ticking clock is pressure, and the request came from the people who
 *    need it. Either way the choice is remembered per browser.
 *
 * Past the end it keeps counting, prefixed with "+": the room does not close at
 * `endsAt` (an open-ended event just shows the overtime banner), so a timer that
 * stopped there would be lying at exactly the moment it matters most.
 */
interface EventTimerProps {
  startsAt: string;
  endsAt: string;
  /** Moderators and speakers get it on by default. */
  defaultVisible?: boolean;
}

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

export default function EventTimer({ startsAt, endsAt, defaultVisible = false }: EventTimerProps) {
  const t = useTranslations('live.timer');
  const [now, setNow] = useState<number | null>(null);
  const [visible, setVisible] = useState(defaultVisible);
  const [mode, setMode] = useState<'remaining' | 'elapsed'>('remaining');

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

  if (now === null) return null;

  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;

  const remaining = end - now;
  const elapsed = now - start;
  const overtime = remaining < 0;

  const label =
    mode === 'remaining'
      ? `${overtime ? '+' : ''}${formatSpan(remaining)}`
      : formatSpan(elapsed);

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

  if (!visible) {
    return (
      <button
        type="button"
        className="live-timer live-timer--off"
        onClick={toggleVisible}
        aria-label={t('show')}
        title={t('show')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15 14" />
        </svg>
      </button>
    );
  }

  return (
    <span className={`live-timer${overtime && mode === 'remaining' ? ' live-timer--over' : ''}`}>
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
    </span>
  );
}
