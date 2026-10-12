'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import ToggleSwitch from '@/components/ui/toggle-switch';
import { useComandiTimer, useTimerInterventi } from '@/hooks/use-presentation-timer';

/**
 * Il timer degli interventi: un conto alla rovescia per chi parla, che chi
 * conduce imposta dalla scheda Regia e può mostrare a tutta la sala.
 */

const PRESETS = [
  { seconds: 300, label: '5min' },
  { seconds: 600, label: '10min' },
  { seconds: 900, label: '15min' },
  { seconds: 1800, label: '30min' },
] as const;

export function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function coloreTimer(remaining: number, duration: number): string {
  if (duration === 0) return '#0066CC';
  const ratio = remaining / duration;
  if (ratio > 0.5) return '#008758';
  if (ratio > 0.25) return '#A66300';
  return '#CC334D';
}

/** La fascia per tutta la sala, quando chi conduce la mostra. */
export default function PresentationTimerBar({ eventSlug }: { eventSlug: string }) {
  const t = useTranslations('timer');
  const timer = useTimerInterventi(eventSlug);
  if (!timer.active || !timer.visible) return null;

  const progress = timer.duration > 0 ? (timer.remaining / timer.duration) * 100 : 0;
  const ultimoMinuto = timer.remaining < 60 && timer.remaining > 0;

  return (
    <div
      className={`text-white px-3 py-1 d-flex align-items-center justify-content-center gap-3 presentation-timer-bar${
        ultimoMinuto ? ' presentation-timer-bar--last' : ''
      }`}
      style={{ backgroundColor: coloreTimer(timer.remaining, timer.duration) }}
    >
      <Icon icon="it-clock" size="sm" color="white" />
      <span className="fw-bold font-monospace" style={{ fontSize: '1.1rem' }}>
        {formatTimer(timer.remaining)}
      </span>
      <div
        className="flex-grow-1 rounded-pill overflow-hidden"
        style={{ height: 6, backgroundColor: 'rgba(255,255,255,0.3)', maxWidth: 200 }}
      >
        <div
          className="h-100 rounded-pill"
          style={{ width: `${progress}%`, backgroundColor: '#fff', transition: 'width 1s linear' }}
        />
      </div>
      {timer.remaining === 0 && <span className="small fw-semibold">{t('timeUp')}</span>}
    </div>
  );
}

/** I comandi, nella scheda Regia. */
export function PresentationTimerControls({ eventSlug, token }: { eventSlug: string; token: string }) {
  const t = useTranslations('timer');
  const tc = useTranslations('common');
  const timer = useTimerInterventi(eventSlug);
  const invia = useComandiTimer(eventSlug, token);
  const [scelta, setScelta] = useState(false);

  if (!timer.active) {
    return scelta ? (
      <div className="d-flex flex-wrap gap-2" role="group" aria-label={t('title')}>
        {PRESETS.map((p) => (
          <Button
            key={p.seconds}
            color="primary"
            size="sm"
            onClick={() => {
              void invia('start', p.seconds);
              setScelta(false);
            }}
          >
            {t(`presets.${p.label}`)}
          </Button>
        ))}
        <Button
          color="secondary"
          outline
          size="sm"
          onClick={() => setScelta(false)}
          aria-label={tc('cancel')}
          title={tc('cancel')}
        >
          <span aria-hidden="true">✕</span>
        </Button>
      </div>
    ) : (
      <Button color="primary" outline size="sm" onClick={() => setScelta(true)}>
        {t('start')}
      </Button>
    );
  }

  return (
    <div className="d-flex flex-wrap align-items-center gap-2">
      <span className="font-monospace fw-bold control-room__timer-value">{formatTimer(timer.remaining)}</span>
      {timer.paused ? (
        <Button color="success" size="sm" onClick={() => void invia('resume')}>
          {t('start')}
        </Button>
      ) : (
        <Button color="warning" size="sm" onClick={() => void invia('pause')}>
          {t('pause')}
        </Button>
      )}
      <Button color="danger" outline size="sm" onClick={() => void invia('reset')}>
        {t('reset')}
      </Button>
      <div className="w-100 mt-1">
        <ToggleSwitch
          label={t('showToAll')}
          checked={timer.visible}
          onChange={(e) => void invia('visibility', undefined, e.target.checked)}
        />
      </div>
    </div>
  );
}
