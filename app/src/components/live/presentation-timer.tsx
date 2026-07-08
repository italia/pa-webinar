'use client';

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

interface PresentationTimerProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
}

interface TimerState {
  active: boolean;
  duration: number;
  remaining: number;
  visible: boolean;
  paused: boolean;
}

const PRESETS = [
  { seconds: 300, label: '5min' },
  { seconds: 600, label: '10min' },
  { seconds: 900, label: '15min' },
  { seconds: 1800, label: '30min' },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function getTimerColor(remaining: number, duration: number): string {
  if (duration === 0) return '#0066CC';
  const ratio = remaining / duration;
  if (ratio > 0.5) return '#008758';
  if (ratio > 0.25) return '#A66300';
  return '#CC334D';
}

export default function PresentationTimer({ eventSlug, token, isModerator }: PresentationTimerProps) {
  const t = useTranslations('timer');
  const [timer, setTimer] = useState<TimerState>({
    active: false, duration: 0, remaining: 0, visible: false, paused: false,
  });
  const [showPresets, setShowPresets] = useState(false);

  const fetchTimer = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventSlug}/timer`);
      if (res.ok) {
        const data: TimerState = await res.json();
        setTimer(data);
      }
    } catch { /* retry */ }
  }, [eventSlug]);

  useEffect(() => {
    fetchTimer();
    const interval = setInterval(fetchTimer, 5000);
    return () => clearInterval(interval);
  }, [fetchTimer]);

  useEffect(() => {
    if (!timer.active || timer.paused || timer.remaining <= 0) return;
    const interval = setInterval(() => {
      setTimer((prev) => ({
        ...prev,
        remaining: Math.max(0, prev.remaining - 1),
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [timer.active, timer.paused, timer.remaining]);

  const sendAction = useCallback(async (action: string, duration?: number, visible?: boolean) => {
    await fetch(`/api/events/${eventSlug}/timer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, duration, visible }),
    });
    fetchTimer();
  }, [eventSlug, token, fetchTimer]);

  // The moderator control lives INLINE in the ModeratorControls dark bar
  // (id="live-timer-control-slot") instead of a full-width row of its own.
  // The slot sits in a sibling that mounts alongside this component; retry a
  // few frames because getElementById is null in SSR / before the bar commits.
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    if (!isModerator) {
      setSlot(null);
      return;
    }
    let tries = 0;
    let raf = 0;
    const find = () => {
      const el = document.getElementById('live-timer-control-slot');
      if (el) {
        setSlot(el);
        return;
      }
      if (tries++ < 30) raf = requestAnimationFrame(find);
    };
    find();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isModerator]);

  if (!isModerator && !timer.visible) return null;
  if (!isModerator && !timer.active) return null;

  const color = getTimerColor(timer.remaining, timer.duration);
  const progress = timer.duration > 0 ? (timer.remaining / timer.duration) * 100 : 0;
  const isPulsing = timer.active && timer.remaining < 60 && timer.remaining > 0;

  // Moderator control — restyled for the dark ModeratorControls bar (light
  // label text, no light background chip). Portalled into the bar slot.
  const control = (
    <div className="d-inline-flex align-items-center gap-2">
      <Icon icon="it-clock" size="xs" color="white" />
      <span className="small fw-semibold text-white-50">{t('title')}</span>

      {!timer.active ? (
        showPresets ? (
          <div className="d-flex gap-1">
            {PRESETS.map((p) => (
              <Button
                key={p.seconds}
                color="primary"
                size="xs"
                onClick={() => { sendAction('start', p.seconds); setShowPresets(false); }}
              >
                {t(`presets.${p.label}`)}
              </Button>
            ))}
            <Button color="secondary" size="xs" onClick={() => setShowPresets(false)}>
              ✕
            </Button>
          </div>
        ) : (
          <Button color="primary" size="xs" onClick={() => setShowPresets(true)}>
            {t('start')}
          </Button>
        )
      ) : (
        <div className="d-flex gap-1 align-items-center">
          <span className="font-monospace fw-bold small text-white">{formatTime(timer.remaining)}</span>
          {timer.paused ? (
            <Button color="success" size="xs" onClick={() => sendAction('start', timer.remaining)}>
              {t('start')}
            </Button>
          ) : (
            <Button color="warning" size="xs" onClick={() => sendAction('pause')}>
              {t('pause')}
            </Button>
          )}
          <Button color="outline-danger" size="xs" onClick={() => sendAction('reset')}>
            {t('reset')}
          </Button>
          <button
            type="button"
            className={`btn btn-sm ${timer.visible ? 'btn-outline-light' : 'btn-outline-secondary'}`}
            style={{ fontSize: '0.7rem', padding: '2px 6px' }}
            onClick={() => sendAction('visibility', undefined, !timer.visible)}
            title={t('showToAll')}
            aria-label={t('showToAll')}
            aria-pressed={timer.visible}
          >
            <Icon icon={timer.visible ? 'it-eye' : 'it-password-invisible'} size="xs" color="white" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Countdown bar (all attendees) — already active+visible guarded, so it
          has zero footprint when off. Stays inline; the moderator control is
          portalled into the controls bar. */}
      {timer.active && timer.visible && (
        <div
          className="text-white px-3 py-1 d-flex align-items-center justify-content-center gap-3"
          style={{
            backgroundColor: color,
            transition: 'background-color 0.5s',
            animation: isPulsing ? 'pulse 1s infinite' : undefined,
          }}
        >
          <Icon icon="it-clock" size="sm" color="white" />
          <span className="fw-bold font-monospace" style={{ fontSize: '1.1rem' }}>
            {formatTime(timer.remaining)}
          </span>
          <div
            className="flex-grow-1 rounded-pill overflow-hidden"
            style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.3)', maxWidth: '200px' }}
          >
            <div
              className="h-100 rounded-pill"
              style={{
                width: `${progress}%`,
                backgroundColor: '#fff',
                transition: 'width 1s linear',
              }}
            />
          </div>
          {timer.remaining === 0 && (
            <span className="small fw-semibold">{t('timeUp')}</span>
          )}
        </div>
      )}

      {/* Moderator control → portalled into the ModeratorControls bar slot so
          it shares the controls line instead of taking a full-width row. */}
      {isModerator && slot && createPortal(control, slot)}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </>
  );
}
