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

/**
 * Trova TUTTI i segmenti attivi all'istante `now` (start <= now < end).
 * Con la registrazione multi-traccia (ADR-013) i segmenti possono
 * sovrapporsi nel tempo, quindi più parlanti possono essere correnti.
 * Non si può usare la binary search "un solo intervallo" (presuppone
 * intervalli disgiunti). I segmenti sono ordinati per start: troviamo
 * l'ultimo con start <= now, poi scansioniamo a ritroso raccogliendo
 * quelli che coprono ancora `now`. Restituiti dal più recente (primario)
 * al più vecchio. Nel caso sequenziale la scansione trova un solo
 * indice e si ferma subito.
 */
function findCurrentIdxs(segments: Segment[], now: number): number[] {
  let lo = 0;
  let hi = segments.length - 1;
  let hiStart = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= now) {
      hiStart = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const out: number[] = [];
  for (let i = hiStart; i >= 0; i--) {
    const s = segments[i]!;
    if (now >= s.start && now < s.end) out.push(i);
    // Stop euristico: improbabile che un segmento iniziato >60s prima
    // copra ancora `now` (le battute non durano minuti). Evita scan O(n).
    if (s.start < now - 60) break;
  }
  return out;
}

export default function MiniTranscript({ playerRef, segments }: Props) {
  const t = useTranslations('postprod');
  const tf = (key: string, fallback: string): string =>
    t.has(key) ? t(key) : fallback;
  // Indici correnti (può essere >1 con overlap multi-traccia). Ordinati
  // dal più recente. Stringa-keyed per confronto stabile fra tick.
  const [currentIdxs, setCurrentIdxs] = useState<number[]>([]);
  const lastKeyRef = useRef<string>('');

  useEffect(() => {
    const v = playerRef.current?.videoEl?.();
    if (!v || segments.length === 0) return undefined;
    let rafId: number | null = null;
    const tick = (): void => {
      const now = v.currentTime;
      const idxs = findCurrentIdxs(segments, now);
      const key = idxs.join(',');
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        setCurrentIdxs(idxs);
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
  }, [playerRef, segments]);

  if (currentIdxs.length === 0) return null;

  // Primario = il segmento corrente iniziato più di recente (primo
  // dell'array, che è ordinato dal più recente). prev/next sono calcolati
  // rispetto al primario per dare contesto. Gli altri correnti (overlap)
  // sono parlanti simultanei, mostrati tutti come righe "active".
  const primaryIdx = currentIdxs[0]!;
  const overlapping = currentIdxs.length > 1;
  // Mostriamo i correnti in ordine cronologico (per start) per stabilità
  // visiva quando sono più di uno.
  const currentSorted = [...currentIdxs].sort(
    (a, b) => segments[a]!.start - segments[b]!.start,
  );
  const prev = primaryIdx > 0 ? segments[primaryIdx - 1]! : null;
  const next =
    primaryIdx < segments.length - 1 ? segments[primaryIdx + 1]! : null;
  // prev/next non devono duplicare un segmento già mostrato come corrente
  // (può capitare con gli overlap: il "successivo per indice" è in realtà
  // già attivo).
  const prevSeg = prev && !currentIdxs.includes(primaryIdx - 1) ? prev : null;
  const nextSeg = next && !currentIdxs.includes(primaryIdx + 1) ? next : null;

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
        {overlapping && (
          // Badge "parlato simultaneo": più parlanti correnti insieme.
          // Inline SVG (niente <Icon> design-react-kit per evitare
          // hydration mismatch — vedi note progetto).
          <span
            className="d-inline-flex align-items-center gap-1"
            title={tf(
              'overlapTitle',
              'Parlato simultaneo: in questo intervallo parla più di una persona contemporaneamente.',
            )}
            style={{
              color: '#6633CC',
              background: '#6633CC14',
              border: '1px solid #6633CC55',
              borderRadius: 4,
              padding: '0 5px',
              letterSpacing: 0,
              textTransform: 'none',
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M8 10h6M8 14h4" />
              <path d="M3 15a2 2 0 0 0 2 2h1v3l3-3h4a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
              <path d="M9 5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1" />
            </svg>
            {tf('overlapBadge', 'simultaneo')}
          </span>
        )}
      </div>

      {prevSeg && <Row seg={prevSeg} dim onSeek={seek} />}
      {currentSorted.map((i) => (
        <Row key={`cur-${i}`} seg={segments[i]!} active onSeek={seek} />
      ))}
      {nextSeg && <Row seg={nextSeg} dim onSeek={seek} />}
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
