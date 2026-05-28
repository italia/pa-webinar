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
 *
 * Improvements:
 *   - search input (live filter + highlight keywords)
 *   - download dropdown (.txt / .srt / .vtt / summary .md)
 *   - smooth scroll auto-center for active segment
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  speakerColor,
  initials as speakerInitials,
} from '@/lib/utils/speaker-palette';

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
  /** Slug evento — usato per costruire gli endpoint di download. Quando
   *  assente, il menu Scarica viene nascosto. */
  eventSlug?: string;
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

/**
 * Escape RegExp meta-characters in a user-supplied query so we can
 * highlight literal matches safely (and avoid silently swallowing
 * "?", "*", "(" etc.).
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits `text` at every occurrence of `query` (case-insensitive) and
 * returns an array of React nodes with the matched ranges wrapped in
 * a highlight span. Returns the plain text as a single string when
 * the query is empty.
 */
function highlightMatches(
  text: string,
  query: string,
): Array<string | ReactElement> {
  if (!query) return [text];
  const re = new RegExp(escapeRegExp(query), 'gi');
  const out: Array<string | ReactElement> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={`m-${k++}`} className="postprod-segment__match">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1; // avoid infinite loop on zero-width
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function TranscriptPanel({
  playerRef,
  endpoint,
  eventSlug,
  activeLanguage,
}: TranscriptPanelProps) {
  const t = useTranslations('postprod');
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'transcript' | 'summary'>('transcript');
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [search, setSearch] = useState<string>('');
  const [showDownload, setShowDownload] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

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

  // Auto-scroll the active segment into view (smooth, center). Skip
  // while the user is actively filtering (search) — il container è
  // ridisegnato e lo scroll programmatico rovinerebbe il flusso di
  // lettura.
  useEffect(() => {
    if (activeIdx < 0) return;
    if (search.trim().length > 0) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-segment-idx="${activeIdx}"]`,
    );
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    // Centriamo sempre quando esce dalla zona di confort (40% top/bottom
    // del viewport del container).
    const margin = cRect.height * 0.2;
    const out =
      eRect.top < cRect.top + margin || eRect.bottom > cRect.bottom - margin;
    if (out) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIdx, search]);

  // Close download dropdown on outside click / Escape.
  useEffect(() => {
    if (!showDownload) return;
    const onDocClick = (e: MouseEvent): void => {
      if (!downloadRef.current) return;
      if (!downloadRef.current.contains(e.target as Node)) {
        setShowDownload(false);
      }
    };
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setShowDownload(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showDownload]);

  function seekTo(start: number): void {
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

  // Filtered list. Memoized: filtering ricalcolato solo quando i
  // segmenti o la query cambiano.
  const filteredSegments = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.segments.map((seg, idx) => ({ seg, idx }));
    return data.segments
      .map((seg, idx) => ({ seg, idx }))
      .filter(({ seg }) => seg.text.toLowerCase().includes(q));
  }, [data, search]);

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

  const trimmedSearch = search.trim();
  const showSearchStatus = trimmedSearch.length > 0;
  const downloadLang = activeLanguage ?? data.sourceLanguage;
  const downloadEnabled = !!eventSlug;

  return (
    <div className="postprod-panel">
      <div
        className="postprod-panel__badge alert alert-info py-2 small mb-3"
        role="note"
      >
        <strong>{t('aiBadgeLabel')}</strong> · {t('aiBadgeBody')}
      </div>

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
        <ul className="nav nav-pills mb-0" role="tablist">
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

        {downloadEnabled && (
          <div className="postprod-download" ref={downloadRef}>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary d-inline-flex align-items-center gap-1"
              onClick={() => setShowDownload((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={showDownload}
              aria-label={t('downloadMenu')}
              style={{ borderRadius: 20 }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
              </svg>
              {t('downloadLabel')}
            </button>
            {showDownload && (
              <div role="menu" className="postprod-download__menu">
                <a
                  role="menuitem"
                  className="postprod-download__item"
                  href={`/api/events/${eventSlug}/postprod/download/transcript.txt?lang=${downloadLang}`}
                  download
                  onClick={() => setShowDownload(false)}
                >
                  {t('downloadTranscriptTxt')}
                </a>
                <a
                  role="menuitem"
                  className="postprod-download__item"
                  href={`/api/events/${eventSlug}/postprod/download/transcript.srt?lang=${downloadLang}`}
                  download
                  onClick={() => setShowDownload(false)}
                >
                  {t('downloadTranscriptSrt')}
                </a>
                <a
                  role="menuitem"
                  className="postprod-download__item"
                  href={`/api/events/${eventSlug}/postprod/subtitle/${downloadLang}`}
                  download={`subtitles.${downloadLang}.vtt`}
                  onClick={() => setShowDownload(false)}
                >
                  {t('downloadTranscriptVtt')}
                </a>
                {summaryLang && (
                  <a
                    role="menuitem"
                    className="postprod-download__item"
                    href={`/api/events/${eventSlug}/postprod/download/summary.md?lang=${summaryLang}`}
                    download
                    onClick={() => setShowDownload(false)}
                  >
                    {t('downloadSummaryMd')}
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {tab === 'transcript' && (
        <>
          <div className="postprod-panel__search">
            <label htmlFor="postprod-search" className="visually-hidden">
              {t('searchLabel')}
            </label>
            {/* select NATIVO non serve qui — è un text input. Restiamo
                fuori dal pattern Input di design-react-kit per non
                triggerare React #137 in caso di re-render. */}
            <input
              id="postprod-search"
              type="search"
              className="form-control form-control-sm"
              placeholder={t('searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={t('searchLabel')}
              autoComplete="off"
            />
            {search.length > 0 && (
              <button
                type="button"
                className="postprod-panel__search-clear"
                onClick={() => setSearch('')}
                aria-label={t('searchClear')}
                title={t('searchClear')}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>

          {showSearchStatus && (
            <div
              className="postprod-panel__search-status"
              role="status"
              aria-live="polite"
            >
              {filteredSegments.length === 0
                ? t('searchNoMatches', { query: trimmedSearch })
                : t('searchMatches', { count: filteredSegments.length })}
            </div>
          )}

          <div
            ref={containerRef}
            className="postprod-panel__transcript"
            style={{ maxHeight: 480, overflowY: 'auto' }}
            role="region"
            aria-label={t('tabTranscript')}
          >
            {filteredSegments.map(({ seg, idx }) => {
              const speakerLabel = seg.speakerName ?? seg.speaker ?? '—';
              const isActive = idx === activeIdx;
              // Palette stabile per speaker — stesso colore in tutti i
              // segmenti dello stesso parlante. Identity key = displayName
              // se mapped, altrimenti il diarLabel anonimo.
              const identity = seg.speakerName ?? seg.speaker ?? '';
              const palette = speakerColor(identity);
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
                    borderLeft: `3px solid ${isActive ? palette.color : palette.color + '66'}`,
                    background: isActive ? palette.bg : undefined,
                  }}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <div className="d-flex align-items-center gap-2 small mb-1">
                    <code
                      style={{
                        minWidth: 56,
                        color: '#5A768A',
                        fontVariantNumeric: 'tabular-nums',
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
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        background: palette.color,
                        color: 'white',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {speakerInitials(speakerLabel)}
                    </span>
                    <span className="fw-semibold" style={{ color: palette.color }}>
                      {speakerLabel}
                    </span>
                  </div>
                  <div className="postprod-segment__text">
                    {highlightMatches(seg.text, trimmedSearch)}
                  </div>
                </button>
              );
            })}
          </div>
        </>
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
