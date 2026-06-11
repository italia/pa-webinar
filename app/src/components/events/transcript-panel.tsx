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
import { Icon } from 'design-react-kit';
import type React from 'react';

import {
  speakerColor,
  initials as speakerInitials,
} from '@/lib/utils/speaker-palette';
import { useBookmarks } from '@/lib/utils/use-bookmarks';
import { MarkdownRenderer } from '@/components/ui/markdown';

import type { VideoPlayerHandle } from './video-player';

interface SegmentWord {
  start: number;
  end: number;
  word: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
  speakerName: string | null;
  words?: SegmentWord[];
  lowConfidence?: boolean;
}

interface TranscriptResponse {
  recordingId: string;
  sourceLanguage: string;
  segments: Segment[];
  subtitleTracks: string[];
  summaries: Record<string, string>;
  speakers: Array<{ diarLabel: string; displayName: string | null }>;
  /**
   * True quando il transcript proviene dalla pipeline multi-traccia
   * (ADR-013): i segmenti POSSONO sovrapporsi nel tempo (parlato
   * simultaneo). La route oggi non lo propaga sempre, perciò la UI non
   * si affida a questo flag: l'overlap è rilevato per-segmento sui
   * timestamp (vedi `computeOverlapInfo`). Tenuto qui solo per
   * documentazione / eventuale uso futuro.
   */
  multitrack?: boolean;
}

/**
 * Metadati di sovrapposizione per-segmento. `concurrent` è true quando
 * il segmento si sovrappone nel tempo ad almeno un altro segmento di
 * uno speaker DIVERSO (parlato simultaneo). Nel caso sequenziale
 * (pyannote: un solo speaker per istante) `concurrent` resta sempre
 * false e la UI è identica a prima.
 */
interface OverlapInfo {
  concurrent: boolean;
}

/**
 * Calcola, per ogni segmento, se si sovrappone temporalmente ad altri
 * segmenti di speaker diversi. I segmenti arrivano ordinati per
 * (start, end) dalla route; due segmenti [aS,aE) e [bS,bE) si
 * sovrappongono se `aS < bE && bS < aE`. Scansione lineare con finestra
 * scorrevole dei segmenti "ancora aperti" (la cui fine supera l'inizio
 * del corrente): O(n) nel caso sequenziale, O(n·k) con k = grado di
 * sovrapposizione locale. Non assume `end[i] <= start[i+1]`.
 */
function computeOverlapInfo(segments: Segment[]): OverlapInfo[] {
  const info: OverlapInfo[] = segments.map(() => ({ concurrent: false }));
  const open: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i]!;
    // Chiudi la finestra: rimuovi i segmenti terminati prima dell'inizio
    // del corrente — non possono più sovrapporsi a niente di successivo.
    for (let w = open.length - 1; w >= 0; w--) {
      const j = open[w]!;
      if (segments[j]!.end <= cur.start) open.splice(w, 1);
    }
    for (const j of open) {
      const other = segments[j]!;
      // Per la finestra: other.end > cur.start e other.start <= cur.start
      // ⇒ overlap garantito. Marca "concurrent" solo se lo speaker è
      // diverso: due segmenti adiacenti dello stesso parlante non sono
      // "simultaneo".
      const sameSpeaker =
        (cur.speaker ?? cur.speakerName) ===
        (other.speaker ?? other.speakerName);
      if (!sameSpeaker) {
        info[i]!.concurrent = true;
        info[j]!.concurrent = true;
      }
    }
    open.push(i);
  }
  return info;
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

/**
 * Renderizza il testo di un segmento con highlight per-parola
 * sincronizzato col playhead del video. Le parole prima del cursore
 * temporale appaiono nel colore semantico (dim), quella corrente
 * viene evidenziata col background del segment (full color), quelle
 * successive appaiono dim. Effetto karaoke leggero — niente
 * animazione brusca, niente "spinta" del layout (le parole occupano
 * lo stesso spazio in ogni stato).
 */
function WordLevelText({
  words,
  playheadSec,
  color,
}: {
  words: SegmentWord[];
  playheadSec: number;
  color: string;
}) {
  return (
    <span className="postprod-segment__words">
      {words.map((w, i) => {
        const passed = playheadSec >= w.end;
        const current = !passed && playheadSec >= w.start;
        return (
          <span
            key={`${w.start}-${i}`}
            className="postprod-segment__word"
            style={{
              color: passed ? color : current ? '#0c1a2b' : 'var(--app-muted)',
              fontWeight: current ? 600 : 400,
              background: current ? color + '22' : undefined,
              borderRadius: current ? 3 : 0,
              padding: current ? '0 2px' : '0',
              transition: 'color 0.12s, background 0.12s',
            }}
          >
            {w.word}
          </span>
        );
      })}
    </span>
  );
}

export default function TranscriptPanel({
  playerRef,
  endpoint,
  eventSlug,
  activeLanguage,
}: TranscriptPanelProps) {
  const t = useTranslations('postprod');
  // Fallback inline temporaneo per le chiavi overlap non ancora presenti
  // nei file i18n (vedi report). Quando le chiavi verranno aggiunte,
  // `t.has` diventa true e si usa la traduzione localizzata.
  const tf = (key: string, fallback: string): string =>
    t.has(key) ? t(key) : fallback;
  const [data, setData] = useState<TranscriptResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'transcript' | 'summary'>('transcript');
  /** Indice "primario" attivo: il segmento attivo iniziato più di
   *  recente (per word-level karaoke + autoscroll). -1 = nessuno. */
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  /** Insieme di TUTTI gli indici attivi all'istante corrente. Con
   *  overlap (multi-traccia) possono essere >1 — evidenziamo tutti i
   *  parlanti simultanei, non solo il primario. Nel caso sequenziale
   *  contiene al più un indice. Set per lookup O(1) nel render. */
  const [activeSet, setActiveSet] = useState<ReadonlySet<number>>(
    () => new Set(),
  );
  const [search, setSearch] = useState<string>('');
  const [showDownload, setShowDownload] = useState<boolean>(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  /** Follow-mode: quando true, l'autoscroll segue il segment attivo;
   *  passa a false quando l'utente scrolla manualmente fino a quando
   *  preme "Riprendi" o torna sopra il segment attivo. */
  const [followLive, setFollowLive] = useState<boolean>(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const downloadRef = useRef<HTMLDivElement>(null);
  const bookmarks = useBookmarks(eventSlug ?? '');

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

  // Tempo corrente del video — alimenta sia l'highlight del segment
  // sia il highlight word-level. requestAnimationFrame anziché solo
  // timeupdate (che fa fire ogni 250ms su Chrome) per avere un
  // segno fluido sulle parole; cap a ~10fps quando il video è in
  // pausa per non sprecare cicli.
  const [playheadSec, setPlayheadSec] = useState(0);
  useEffect(() => {
    const video = resolveVideo(playerRef);
    if (!video || !data) return;
    let rafId: number | null = null;
    const tick = (): void => {
      setPlayheadSec(video.currentTime);
      rafId = window.requestAnimationFrame(tick);
    };
    const onPlay = (): void => {
      if (rafId == null) rafId = window.requestAnimationFrame(tick);
    };
    const onPause = (): void => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      rafId = null;
      setPlayheadSec(video.currentTime);
    };
    const onSeek = (): void => setPlayheadSec(video.currentTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', onSeek);
    if (!video.paused) onPlay();
    else onPause();
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeked', onSeek);
    };
  }, [data, playerRef]);

  // Calcola gli indici attivi dal playhead. NON si può usare la binary
  // search "un solo intervallo" perché con il multi-traccia i segmenti
  // possono sovrapporsi (più segmenti attivi nello stesso istante) e
  // non valgono i presupposti di ordinamento per la ricerca binaria
  // sugli end. Usiamo invece una binary search per il primo indice con
  // `start <= now` e poi scansioniamo a ritroso i candidati che possono
  // ancora coprire `now` (start <= now < end). Nel caso sequenziale
  // questa scansione si ferma quasi subito (overlap nullo).
  useEffect(() => {
    if (!data) return;
    const segments = data.segments;
    const now = playheadSec;

    // Binary search: ultimo indice con start <= now (segmenti ordinati
    // per start). I segmenti che coprono `now` hanno tutti start <= now,
    // quindi stanno in [0..hiStart].
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

    // Scansiona a ritroso da hiStart raccogliendo tutti i segmenti che
    // coprono `now`. Mi fermo quando il massimo `end` ancora possibile
    // non può più raggiungere `now`: dato che gli end NON sono ordinati,
    // mi affido al fatto che gli overlap sono locali (qualche segmento),
    // limitando comunque la scansione a una finestra ragionevole.
    const active: number[] = [];
    let primary = -1;
    for (let i = hiStart; i >= 0; i--) {
      const s = segments[i]!;
      if (now >= s.start && now < s.end) {
        active.push(i);
        // primario = quello iniziato più di recente fra gli attivi;
        // hiStart scorre da start decrescenti ⇒ il primo trovato vince.
        if (primary === -1) primary = i;
      }
      // Heuristica di stop: se siamo già indietro di oltre 60s rispetto
      // a `now`, è improbabile che un segmento ancora più vecchio copra
      // `now` (le battute non durano minuti). Evita scan O(n) su long-form.
      if (s.start < now - 60) break;
    }

    if (activeIdx !== primary) setActiveIdx(primary);
    // Aggiorna activeSet solo se cambiato (evita re-render inutili).
    setActiveSet((prev) => {
      if (prev.size === active.length && active.every((i) => prev.has(i))) {
        return prev;
      }
      return new Set(active);
    });
  }, [playheadSec, data, activeIdx]);

  // Auto-scroll the active segment into view (smooth, center). Skip
  // while:
  //   - l'utente sta filtrando (search): container ridisegnato
  //   - follow-mode è OFF (l'utente sta leggendo "in libertà")
  useEffect(() => {
    if (activeIdx < 0) return;
    if (search.trim().length > 0) return;
    if (!followLive) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-segment-idx="${activeIdx}"]`,
    );
    if (!el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const margin = cRect.height * 0.2;
    const out =
      eRect.top < cRect.top + margin || eRect.bottom > cRect.bottom - margin;
    if (out) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIdx, search, followLive]);

  // Follow-mode UX: se l'utente scrolla dentro il container con la
  // rotella / dito, disattiva il follow finché non clicca "Riprendi".
  // Distinguamo lo scroll user-driven (wheel / touchmove / keydown
  // nei tasti freccia) dallo scroll programmatico (scrollIntoView
  // chiamato sopra), che NON deve disattivare il follow.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return undefined;
    const stop = () => setFollowLive(false);
    c.addEventListener('wheel', stop, { passive: true });
    c.addEventListener('touchmove', stop, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowUp' ||
        e.key === 'PageDown' ||
        e.key === 'PageUp' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        stop();
      }
    };
    c.addEventListener('keydown', onKey);
    return () => {
      c.removeEventListener('wheel', stop);
      c.removeEventListener('touchmove', stop);
      c.removeEventListener('keydown', onKey);
    };
  }, []);

  // Quando il follow viene riattivato, ri-centra subito il segment attivo.
  useEffect(() => {
    if (!followLive || activeIdx < 0) return;
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-segment-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [followLive, activeIdx]);

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

  // Overlap per-segmento. Memoizzato sui segmenti: nel caso sequenziale
  // è tutto false (nessun costo a runtime nel render).
  const overlapInfo = useMemo(
    () => (data ? computeOverlapInfo(data.segments) : []),
    [data],
  );

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

          {/* Follow-mode indicator + Riprendi (visibile solo quando OFF) */}
          {!followLive && (
            <button
              type="button"
              onClick={() => setFollowLive(true)}
              className="btn btn-sm d-inline-flex align-items-center gap-1 mb-2"
              style={{
                fontSize: '0.78rem',
                background: '#FFF6DA',
                color: '#7A5A00',
                border: '1px solid #F2D88A',
                borderRadius: 999,
                padding: '4px 12px',
              }}
            >
              <Icon icon="it-refresh" size="sm" color={undefined} />
              {t('followResume')}
            </button>
          )}
          <div
            ref={containerRef}
            className="postprod-panel__transcript"
            style={{ maxHeight: 480, overflowY: 'auto' }}
            role="region"
            aria-label={t('tabTranscript')}
            tabIndex={0}
          >
            {filteredSegments.map(({ seg, idx }) => {
              const speakerLabel = seg.speakerName ?? seg.speaker ?? '—';
              // "active" = evidenziato (qualsiasi segmento attivo ora,
              // anche se concorrente). "isPrimary" = il segmento su cui
              // gira il karaoke word-level e l'autoscroll (uno solo).
              const isActive = activeSet.has(idx) || idx === activeIdx;
              const isPrimary = idx === activeIdx;
              const isOverlap = overlapInfo[idx]?.concurrent ?? false;
              const identity = seg.speakerName ?? seg.speaker ?? '';
              const palette = speakerColor(identity);
              const tSec = Math.floor(seg.start);
              const bookmarked = bookmarks.has(tSec);
              const isCopied = copiedIdx === idx;
              const shareUrl =
                typeof window === 'undefined'
                  ? ''
                  : `${window.location.origin}${window.location.pathname.split('#')[0]}#t=${tSec}`;
              const copyShare = async (e: React.MouseEvent) => {
                e.stopPropagation();
                if (!shareUrl) return;
                try {
                  await navigator.clipboard?.writeText(shareUrl);
                  setCopiedIdx(idx);
                  window.setTimeout(
                    () => setCopiedIdx((p) => (p === idx ? null : p)),
                    2000,
                  );
                } catch {
                  // ignore
                }
              };
              const toggleBookmark = (e: React.MouseEvent) => {
                e.stopPropagation();
                if (bookmarked) bookmarks.remove(tSec);
                else
                  bookmarks.add({
                    tSec,
                    label: `${speakerLabel}: ${seg.text.slice(0, 80)}`,
                  });
              };
              return (
                <div
                  key={`${seg.start}-${idx}`}
                  data-segment-idx={idx}
                  className={`postprod-segment d-block p-2 ${
                    isActive ? 'postprod-segment--active' : ''
                  }`}
                  style={{
                    borderLeft: `3px solid ${isActive ? palette.color : palette.color + '66'}`,
                    background: isActive ? palette.bg : undefined,
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => seekTo(seg.start)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      seekTo(seg.start);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="d-flex align-items-center gap-2 small mb-1">
                    <code
                      style={{
                        minWidth: 56,
                        color: 'var(--app-muted)',
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
                    {isOverlap && (
                      // Marcatore "parlato simultaneo": il segmento si
                      // sovrappone nel tempo a quello di un altro
                      // parlante. Inline SVG (niente <Icon> di
                      // design-react-kit: causa hydration mismatch nei
                      // nodi renderizzati in liste — vedi note progetto).
                      <span
                        title={tf(
                          'overlapTitle',
                          'Parlato simultaneo: in questo intervallo parla più di una persona contemporaneamente.',
                        )}
                        aria-label={tf(
                          'overlapTitle',
                          'Parlato simultaneo: in questo intervallo parla più di una persona contemporaneamente.',
                        )}
                        className="d-inline-flex align-items-center gap-1"
                        style={{
                          marginLeft: 2,
                          fontSize: 11,
                          color: '#6633CC',
                          background: '#6633CC14',
                          border: '1px solid #6633CC55',
                          borderRadius: 4,
                          padding: '0 5px',
                          lineHeight: 1.4,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <svg
                          width="11"
                          height="11"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          {/* due fumetti sovrapposti = voci concorrenti */}
                          <path d="M8 10h6M8 14h4" />
                          <path d="M3 15a2 2 0 0 0 2 2h1v3l3-3h4a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" />
                          <path d="M9 5V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-1" />
                        </svg>
                        {tf('overlapBadge', 'simultaneo')}
                      </span>
                    )}
                    {seg.lowConfidence && (
                      <span
                        title={t('lowConfidenceTitle')}
                        aria-label={t('lowConfidenceTitle')}
                        className="d-inline-flex align-items-center"
                        style={{
                          marginLeft: 4,
                          fontSize: 11,
                          color: '#A66300',
                          background: '#FFF6DA',
                          border: '1px solid #F2D88A',
                          borderRadius: 4,
                          padding: '0 5px',
                          lineHeight: 1.4,
                        }}
                      >
                        {t('lowConfidenceBadge')}
                      </span>
                    )}
                    <div className="ms-auto d-flex align-items-center gap-1 postprod-segment__actions">
                      <button
                        type="button"
                        onClick={toggleBookmark}
                        title={bookmarked ? t('bookmarkRemove') : t('bookmarkAdd')}
                        aria-label={bookmarked ? t('bookmarkRemove') : t('bookmarkAdd')}
                        className="btn p-0 border-0 bg-transparent"
                        style={{
                          width: 26,
                          height: 26,
                          color: bookmarked ? '#FFC107' : '#9AAAB8',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon
                          icon={bookmarked ? 'it-star-full' : 'it-star-outline'}
                          size="sm"
                          color={undefined}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={copyShare}
                        title={isCopied ? t('shareSegmentCopied') : t('shareSegment')}
                        aria-label={isCopied ? t('shareSegmentCopied') : t('shareSegment')}
                        className="btn p-0 border-0 bg-transparent"
                        style={{
                          width: 26,
                          height: 26,
                          color: isCopied ? palette.color : '#9AAAB8',
                          cursor: 'pointer',
                        }}
                      >
                        <Icon
                          icon={isCopied ? 'it-check' : 'it-link'}
                          size="sm"
                          color={undefined}
                        />
                      </button>
                    </div>
                  </div>
                  <div className="postprod-segment__text">
                    {isPrimary && seg.words && seg.words.length > 0 && !trimmedSearch ? (
                      <WordLevelText
                        words={seg.words}
                        playheadSec={playheadSec}
                        color={palette.color}
                      />
                    ) : (
                      highlightMatches(seg.text, trimmedSearch)
                    )}
                  </div>
                </div>
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
          {/* Sintesi in markdown: resa via MarkdownRenderer (marked +
              DOMPurify) come le description evento, così heading/liste/
              grassetti sono formattati. Questo è il surface secondario:
              quando esiste un SUMMARY_JSON strutturato, la card hero
              (PostEventHero) sopra il video è quella primaria. */}
          <MarkdownRenderer
            content={data.summaries[summaryLang] ?? ''}
            className="bg-white border rounded p-3"
          />
          <p className="text-muted small mt-2 mb-0">{t('aiBadgeBody')}</p>
        </div>
      )}
    </div>
  );
}
