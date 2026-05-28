'use client';

/**
 * Mini-transcript inline: 3 righe (precedente, attiva, successiva)
 * che seguono il playhead in tempo reale. Posizionato subito sotto
 * il video — l'utente non deve scrollare per vedere chi sta parlando
 * e cosa sta dicendo.
 *
 * Differenza dal TranscriptPanel completo:
 *   - solo 3 segmenti visibili (compatto, ~120px height)
 *   - read-only (niente click-to-seek, niente search, niente download)
 *   - autoscroll non disattivabile (qui il sync è il valore aggiunto)
 *
 * Chi vuole la trascrizione "full" continua a usare il tab dedicato
 * nel PostEventTabs sotto.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import { speakerColor, initials } from '@/lib/utils/speaker-palette';

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  speakerName: string | null;
}

interface Props {
  playerRef: RefObject<VideoPlayerHandle | null>;
  segments: Segment[];
}

function formatTs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function MiniTranscript({ playerRef, segments }: Props) {
  const t = useTranslations('postprod');
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const lastIdxRef = useRef(0);

  useEffect(() => {
    const v = playerRef.current?.videoEl?.();
    if (!v || segments.length === 0) return undefined;
    let rafId: number | null = null;
    const tick = (): void => {
      const now = v.currentTime;
      const li = Math.max(0, Math.min(segments.length - 1, lastIdxRef.current));
      const here = segments[li];
      if (here && now >= here.start && now <= here.end) {
        if (activeIdx !== li) setActiveIdx(li);
      } else {
        // binary search fallback
        let lo = 0;
        let hi = segments.length - 1;
        let found = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const s = segments[mid]!;
          if (now < s.start) hi = mid - 1;
          else if (now > s.end) lo = mid + 1;
          else {
            found = mid;
            break;
          }
        }
        if (found !== -1) {
          lastIdxRef.current = found;
          setActiveIdx(found);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (rafId == null) rafId = window.requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      rafId = null;
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    if (!v.paused) onPlay();
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [playerRef, segments, activeIdx]);

  if (activeIdx < 0) return null;

  // Mostra: precedente (opacità 50%), attivo (full), successivo (opacità 50%)
  const prev = activeIdx > 0 ? segments[activeIdx - 1]! : null;
  const curr = segments[activeIdx]!;
  const next = activeIdx < segments.length - 1 ? segments[activeIdx + 1]! : null;

  const seek = (sec: number) => {
    playerRef.current?.seekTo?.(sec, true);
  };

  return (
    <section
      className="mini-transcript mb-3"
      aria-label={t('miniTranscriptLabel')}
      style={{
        borderRadius: 10,
        background: '#f7faff',
        border: '1px solid #d6e3f1',
        padding: 12,
      }}
    >
      <div
        className="text-uppercase fw-semibold text-muted mb-2 d-flex align-items-center gap-2"
        style={{ fontSize: '0.68rem', letterSpacing: 0.7 }}
      >
        <span
          className="d-inline-block"
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            background: '#CC334D',
            animation: 'mini-transcript-pulse 1.4s ease-in-out infinite',
          }}
        />
        {t('miniTranscriptLabel')}
      </div>

      {prev && <Row seg={prev} dim onSeek={seek} />}
      <Row seg={curr} active onSeek={seek} />
      {next && <Row seg={next} dim onSeek={seek} />}
    </section>
  );
}

function Row({
  seg,
  active,
  dim,
  onSeek,
}: {
  seg: Segment;
  active?: boolean;
  dim?: boolean;
  onSeek: (sec: number) => void;
}) {
  const label = seg.speakerName ?? seg.speaker ?? '—';
  const palette = speakerColor(label);
  return (
    <button
      type="button"
      onClick={() => onSeek(seg.start)}
      className="d-block text-start w-100 border-0 bg-transparent p-1"
      style={{
        cursor: 'pointer',
        opacity: dim ? 0.55 : 1,
        transition: 'opacity 0.18s',
      }}
    >
      <div className="d-flex align-items-start gap-2">
        <code
          style={{
            minWidth: 50,
            color: '#5A768A',
            fontVariantNumeric: 'tabular-nums',
            fontSize: active ? '0.78rem' : '0.72rem',
            paddingTop: active ? 4 : 2,
          }}
        >
          {formatTs(seg.start)}
        </code>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: active ? 22 : 18,
            height: active ? 22 : 18,
            borderRadius: 11,
            background: palette.color,
            color: 'white',
            fontSize: active ? 10 : 9,
            fontWeight: 700,
            flexShrink: 0,
            marginTop: active ? 1 : 2,
          }}
        >
          {initials(label)}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            className="fw-semibold"
            style={{
              color: palette.color,
              fontSize: active ? '0.82rem' : '0.74rem',
              lineHeight: 1.2,
            }}
          >
            {label}
          </div>
          <div
            style={{
              color: active ? '#26354A' : '#5A768A',
              fontSize: active ? '1rem' : '0.85rem',
              lineHeight: 1.45,
            }}
          >
            {seg.text}
          </div>
        </div>
      </div>
    </button>
  );
}
