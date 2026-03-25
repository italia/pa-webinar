'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';

interface AudioPlayerProps {
  audioUrl?: string | null;
}

const TARGET_VOLUME = 0.3;
const FADE_STEP = 0.03;
const FADE_INTERVAL_MS = 100;

export default function AudioPlayer({ audioUrl }: AudioPlayerProps) {
  const t = useTranslations('live');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const audio = new Audio(audioUrl || '/audio/waiting-room-default.mp3');
    audio.loop = true;
    audio.volume = 0;
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audioUrl]);

  const fadeIn = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.play().then(() => {
      setPlaying(true);
      let vol = 0;
      const interval = setInterval(() => {
        vol = Math.min(vol + FADE_STEP, TARGET_VOLUME);
        audio.volume = vol;
        if (vol >= TARGET_VOLUME) clearInterval(interval);
      }, FADE_INTERVAL_MS);
    }).catch(() => {
      setPlaying(false);
    });
  }, []);

  const fadeOut = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let vol = audio.volume;
    const interval = setInterval(() => {
      vol = Math.max(vol - FADE_STEP, 0);
      audio.volume = vol;
      if (vol <= 0) {
        clearInterval(interval);
        audio.pause();
        setPlaying(false);
      }
    }, FADE_INTERVAL_MS);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      fadeOut();
    } else {
      fadeIn();
    }
  }, [playing, fadeIn, fadeOut]);

  return (
    <button
      type="button"
      onClick={toggle}
      className="d-inline-flex align-items-center gap-2 border-0 bg-transparent p-2 rounded-pill"
      style={{ cursor: 'pointer', transition: 'background 0.2s' }}
      title={playing ? t('disableMusic') : t('enableMusic')}
      aria-label={playing ? t('disableMusic') : t('enableMusic')}
      onMouseOver={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <div
        className={`d-flex align-items-end gap-1 ${playing ? '' : 'equalizer-paused'}`}
        style={{ width: 24, height: 24 }}
      >
        <span className="equalizer-bar" style={{ '--bar-max-height': '12px' } as React.CSSProperties} />
        <span className="equalizer-bar" style={{ '--bar-max-height': '20px' } as React.CSSProperties} />
        <span className="equalizer-bar" style={{ '--bar-max-height': '16px' } as React.CSSProperties} />
        <span className="equalizer-bar" style={{ '--bar-max-height': '22px' } as React.CSSProperties} />
      </div>
      <span className="text-muted" style={{ fontSize: '0.8rem' }}>
        {playing ? t('disableMusic') : t('enableMusic')}
      </span>
    </button>
  );
}
