'use client';

/**
 * TranscriptPanel — click-to-seek transcript view paired with a
 * VideoPlayer instance.
 *
 * Renders the speaker-attributed transcript fetched from
 * `/api/events/[slug]/postprod/transcript`. Clicking on a segment
 * scrolls the player to that timestamp (via a ref forwarded by the
 * parent post-event page). The currently-playing segment is
 * highlighted using the `<video>` element's timeupdate event.
 *
 * Both transcript and summary carry an "AI-generated" disclosure
 * badge per AI Act Art. 50.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import type { VideoPlayerHandle } from './video-player';

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  speakerName: string | null;
}

interface TranscriptResponse {
  recordingId: string;
  sourceLanguage: string;
  segments: Segment[];
  subtitleTracks: string[];
  summaries: Record<string, string>;
  speakers: Array<{ diarLabel: string; displayName: string | null }>;
}

export interface TranscriptPanelProps {
  /**
   * Handle del VideoPlayer parent (via forwardRef). Esposto come
   * RefObject<VideoPlayerHandle | null>. Permette al panel di leggere
   * currentTime e fare seek senza accoppiamento al DOM `<video>`.
   *
   * Legacy: in alternativa si può passare un RefObject<HTMLVideoElement>
   * raw (path retro-compatibile per consumer che ancora non sono
   * migrati al forwardRef). Internamente il panel sceglie il path
   * giusto in base al ref ricevuto.
   */
  playerRef:
    | RefObject<VideoPlayerHandle | null>
    | RefObject<HTMLVideoElement | null>;
  /** Public API path producing TranscriptResponse. */
  endpoint: string;
  /** Currently displayed subtitle language; controls which summary
   *  variant is shown. Null = source language summary. */
  activeLanguage?: string | null;
}

/**
 * Risolve un ref polymorphic in un `HTMLVideoElement | null`. Sia il
 * Handle che il ref raw espongono il `<video>` element — il primo via
 * `videoEl()`, il secondo direttamente.
 */
function resolveVideo(
  ref: RefObject<VideoPlayerHandle | HTMLVideoElement | null>,
): HTMLVideoElement | null {
  const c = ref.current;
  if (!c) return null;
  if (c instanceof HTMLVideoElement) return c;
  // VideoPlayerHandle expose videoEl().
  if ('videoEl' in c && typeof c.videoEl === 'function') return c.videoEl();
  return null;
}

function formatTs(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export default function TranscriptPanel({
  playerRef,
  endpoint,
  activeLanguage,
}: TranscriptPanelProps) {
  const t = useTranslations('postprod');
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'transcript' | 'summary'>('transcript');
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch on mount.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(endpoint, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TranscriptResponse>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  // Track currentTime to highlight the right segment.
  useEffect(() => {
    const video = resolveVideo(playerRef);
    if (!video || !data) return;
    const segments = data.segments;
    const onTime = (): void => {
      const now = video.currentTime;
      // Binary-search-style linear walk — segments are sorted.
      for (let i = 0; i < segments.length; i += 1) {
        const seg = segments[i]!;
        if (now >= seg.start && now <= seg.end) {
          setActiveIdx((prev) => (prev === i ? prev : i));
          return;
        }
      }
      setActiveIdx(-1);
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [data, playerRef]);

  // Auto-scroll the active segment into view (smooth, only when
  // outside the visible area to avoid hijacking the scroll position
  // when the user is reading elsewhere).
  useEffect(() => {
    if (activeIdx < 0) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-segment-idx="${activeIdx}"]`,
    );
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top || eRect.bottom > cRect.bottom) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIdx]);

  function seekTo(start: number): void {
    // Preferiamo il handle quando disponibile (espone seekTo + play in
    // un'unica chiamata); fallback al video element per i consumer
    // legacy che passano un ref raw.
    const c = playerRef.current;
    if (c && !(c instanceof HTMLVideoElement) && 'seekTo' in c) {
      c.seekTo(start, true);
      return;
    }
    const video = resolveVideo(playerRef);
    if (!video) return;
    video.currentTime = start;
    if (video.paused) void video.play();
  }

  if (error) {
    return (
      <div className="alert alert-warning small" role="alert">
        {t('loadError', { error })}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-secondary small p-3">
        {t('loading')}
      </div>
    );
  }
  if (data.segments.length === 0 && Object.keys(data.summaries).length === 0) {
    return (
      <div className="text-secondary small p-3">{t('empty')}</div>
    );
  }

  const summaryLang =
    activeLanguage && data.summaries[activeLanguage]
      ? activeLanguage
      : data.summaries[data.sourceLanguage]
        ? data.sourceLanguage
        : Object.keys(data.summaries)[0] ?? null;

  return (
    <div className="postprod-panel">
      <div
        className="postprod-panel__badge alert alert-info py-2 small mb-3"
        role="note"
      >
        <strong>{t('aiBadgeLabel')}</strong> · {t('aiBadgeBody')}
      </div>

      <ul className="nav nav-pills mb-3" role="tablist">
        <li className="nav-item" role="presentation">
          <button
            type="button"
            className={`nav-link ${tab === 'transcript' ? 'active' : ''}`}
            onClick={() => setTab('transcript')}
            role="tab"
            aria-selected={tab === 'transcript'}
          >
            {t('tabTranscript')}
          </button>
        </li>
        {summaryLang && (
          <li className="nav-item" role="presentation">
            <button
              type="button"
              className={`nav-link ${tab === 'summary' ? 'active' : ''}`}
              onClick={() => setTab('summary')}
              role="tab"
              aria-selected={tab === 'summary'}
            >
              {t('tabSummary')} · {summaryLang.toUpperCase()}
            </button>
          </li>
        )}
      </ul>

      {tab === 'transcript' && (
        <div
          ref={containerRef}
          className="postprod-panel__transcript"
          style={{ maxHeight: 480, overflowY: 'auto' }}
          role="region"
          aria-label={t('tabTranscript')}
        >
          {data.segments.map((seg, idx) => {
            const speakerLabel = seg.speakerName ?? seg.speaker ?? '—';
            const isActive = idx === activeIdx;
            return (
              <button
                key={`${seg.start}-${idx}`}
                type="button"
                data-segment-idx={idx}
                onClick={() => seekTo(seg.start)}
                className={`postprod-segment d-block text-start w-100 border-0 bg-transparent p-2 ${
                  isActive ? 'postprod-segment--active' : ''
                }`}
                style={{
                  borderLeft: isActive
                    ? '3px solid #0066cc'
                    : '3px solid transparent',
                  background: isActive ? 'rgba(0,102,204,0.06)' : undefined,
                }}
              >
                <div className="d-flex gap-2 small text-secondary mb-1">
                  <code style={{ minWidth: 56 }}>{formatTs(seg.start)}</code>
                  <span className="fw-semibold">{speakerLabel}</span>
                </div>
                <div className="postprod-segment__text">{seg.text}</div>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'summary' && summaryLang && (
        <div
          className="postprod-panel__summary"
          style={{ maxHeight: 480, overflowY: 'auto' }}
        >
          {/* The summary is markdown; we render as <pre> for a faithful
              fallback — a future iteration can pipe through `marked`
              like `EventDescription`. */}
          <pre
            className="bg-white border rounded p-3 small"
            style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
          >
            {data.summaries[summaryLang]}
          </pre>
        </div>
      )}
    </div>
  );
}
