'use client';

/**
 * Chip "Sta parlando: <Name>" sovrapposto al video player.
 *
 * Indica chi sta parlando nel momento corrente. Si aggiorna dal
 * `timeupdate` event del `<video>` esposto dal `VideoPlayerHandle`,
 * cercando il segmento attivo nel transcript. Posizionato in alto a
 * destra del player con stile glassmorphism per non coprire il
 * contenuto.
 *
 * Renderizzato solo quando ci sono segmenti del transcript con
 * speakerName mapped. Se lo speaker corrente non ha displayName
 * (ancora SPEAKER_xx), il chip resta nascosto per evitare di
 * mostrare "Sta parlando: SPEAKER_03" che non aiuta il visitatore.
 */

import { useEffect, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import { speakerColor, initials } from '@/lib/utils/speaker-palette';

interface Segment {
  start: number;
  end: number;
  speaker: string | null;
  speakerName: string | null;
}

interface Props {
  playerRef: RefObject<VideoPlayerHandle | null>;
  segments: Segment[];
}

export default function NowSpeakingChip({ playerRef, segments }: Props) {
  const t = useTranslations('postprod');
  const [activeName, setActiveName] = useState<string | null>(null);

  useEffect(() => {
    const el = playerRef.current?.videoEl?.();
    if (!el) return undefined;
    if (segments.length === 0) return undefined;

    const handler = () => {
      const t = el.currentTime;
      // binary search: segmenti ordinati per start ascending
      let lo = 0;
      let hi = segments.length - 1;
      let found: Segment | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segments[mid]!;
        if (t < s.start) hi = mid - 1;
        else if (t > s.end) lo = mid + 1;
        else {
          found = s;
          break;
        }
      }
      // Sceglie il displayName se mapped; ignora label anonimi tipo
      // SPEAKER_03 per evitare rumore visivo.
      const name = found?.speakerName ?? null;
      setActiveName(name);
    };

    handler();
    el.addEventListener('timeupdate', handler);
    el.addEventListener('seeked', handler);
    return () => {
      el.removeEventListener('timeupdate', handler);
      el.removeEventListener('seeked', handler);
    };
  }, [playerRef, segments]);

  if (!activeName) return null;
  const palette = speakerColor(activeName);

  return (
    <div
      className="now-speaking-chip"
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 3,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px 6px 6px',
        borderRadius: 999,
        background: 'rgba(15, 25, 40, 0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        color: '#fff',
        fontSize: '0.82rem',
        fontWeight: 500,
        lineHeight: 1.2,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        transition: 'opacity 0.25s ease, transform 0.25s ease',
      }}
      data-speaker={activeName}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: 13,
          background: palette.color,
          color: 'white',
          fontSize: 11,
          fontWeight: 700,
          border: '2px solid rgba(255,255,255,0.18)',
        }}
      >
        {initials(activeName)}
      </span>
      <span style={{ opacity: 0.65, fontSize: '0.72rem', letterSpacing: 0.3 }}>
        {t('nowSpeaking')}
      </span>
      <span>{activeName}</span>
    </div>
  );
}
