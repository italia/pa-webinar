'use client';

/**
 * "Hero" del post-evento: card prominente sopra il video con la
 * sintesi AI dell'intera registrazione + topic-chip-navigator che
 * fa seek al punto giusto.
 *
 * Renderizzata solo quando esiste un SUMMARY_JSON strutturato per
 * l'evento (cioè la pipeline AI ha prodotto topic segmentation).
 * Quando manca, niente UI — il vecchio render markdown nel
 * TranscriptPanel resta primario.
 */

import { useEffect, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Icon } from 'design-react-kit';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import PipelineProvenance, {
  type PipelineSnapshot,
} from '@/components/events/pipeline-provenance';
import { speakerColor } from '@/lib/utils/speaker-palette';
import { localeDisplayName } from '@/lib/utils/locale-display';

export interface StructuredSummary {
  overall_summary?: string;
  key_decisions?: string[];
  action_items?: string[];
  topics?: Array<{ title?: string; start_mmss?: string; summary?: string }>;
}

interface Props {
  /** Mappa locale → summary strutturato (la pipeline produce IT + EN). */
  structured: Record<string, StructuredSummary>;
  /** Locale corrente; fallback al primo disponibile se non c'è. */
  preferredLocale: string;
  /** Ref del VideoPlayer parent — usato dalle topic chips per seek. */
  playerRef?: RefObject<VideoPlayerHandle | null>;
  /** Slug dell'evento — usato per il link share-at-time. */
  eventSlug?: string;
  /** Snapshot dei modelli usati per produrre questa registrazione.
   *  Quando presente, mostra il link "Trasparenza del processing AI"
   *  in fondo all'hero. */
  pipelineSnapshot?: PipelineSnapshot | null;
  /** Hook quando il visitatore espande "vedi tutto" (analytics opzionale). */
  onExpand?: () => void;
}

const mmssToSec = (mmss: string): number | null => {
  const m = mmss.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

const LANG_STORAGE_KEY = 'eventi-dtd:summary-lang';

export default function PostEventHero({
  structured,
  preferredLocale,
  playerRef,
  eventSlug,
  pipelineSnapshot,
  onExpand,
}: Props) {
  const t = useTranslations('postprod.hero');
  const tShare = useTranslations('postprod');
  const [expanded, setExpanded] = useState(false);

  const availableLocales = Object.keys(structured);
  // Init lang da localStorage prima del preferred, così la scelta
  // dell'utente persiste fra eventi.
  const initialLang = (() => {
    if (availableLocales.length === 0) return preferredLocale;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
      if (stored && availableLocales.includes(stored)) return stored;
    }
    return availableLocales.includes(preferredLocale)
      ? preferredLocale
      : availableLocales[0]!;
  })();
  const [lang, setLang] = useState<string>(initialLang);
  // Allinea se il browser carica un valore stale (es. SSR mismatch).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && availableLocales.includes(stored) && stored !== lang) {
      setLang(stored);
    }
  }, [availableLocales, lang]);

  const onLangChange = (next: string) => {
    setLang(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LANG_STORAGE_KEY, next);
      } catch {
        // localStorage non disponibile (private mode safari etc.) — ignora
      }
    }
  };

  // Hook order must stay stable across renders, so every hook lives
  // ABOVE the `availableLocales.length === 0` early return below. These
  // two pieces of state + the playhead-tracking effect used to sit
  // after the return, which violated rules-of-hooks.
  const [copiedTopic, setCopiedTopic] = useState<number | null>(null);
  const [activeTopicIdx, setActiveTopicIdx] = useState<number>(-1);
  // Topic corrente: l'ultimo topic con `start_mmss` <= playhead. Il
  // chip corrispondente nel topic-navigator viene "illuminato" così
  // l'utente capisce a quale capitolo sta corrispondendo il segmento
  // che sta guardando.
  useEffect(() => {
    if (!playerRef?.current) return undefined;
    const v = playerRef.current.videoEl?.();
    if (!v) return undefined;
    const smEff = structured[lang] ?? structured[Object.keys(structured)[0]!];
    const topicTimes = (smEff?.topics ?? []).map((tp) => mmssToSec(tp.start_mmss ?? ''));
    if (topicTimes.every((t) => t == null)) return undefined;
    let rafId: number | null = null;
    const tick = () => {
      const now = v.currentTime;
      let found = -1;
      for (let i = 0; i < topicTimes.length; i += 1) {
        const t = topicTimes[i];
        if (t != null && now >= t) found = i;
      }
      setActiveTopicIdx(found);
      rafId = window.requestAnimationFrame(tick);
    };
    const onPlay = () => {
      if (rafId == null) rafId = window.requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      rafId = null;
    };
    const onSeek = () => {
      const now = v.currentTime;
      let found = -1;
      for (let i = 0; i < topicTimes.length; i += 1) {
        const t = topicTimes[i];
        if (t != null && now >= t) found = i;
      }
      setActiveTopicIdx(found);
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeek);
    if (!v.paused) onPlay();
    onSeek();
    return () => {
      if (rafId != null) window.cancelAnimationFrame(rafId);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeek);
    };
  }, [playerRef, lang, structured]);

  if (availableLocales.length === 0) return null;
  const sm = structured[lang] ?? structured[availableLocales[0]!]!;

  const shareTopic = async (i: number, mmss: string) => {
    if (!eventSlug || typeof window === 'undefined') return;
    const sec = mmssToSec(mmss);
    if (sec == null) return;
    const url = `${window.location.origin}${window.location.pathname.split('#')[0]}#t=${sec}`;
    try {
      await navigator.clipboard?.writeText(url);
      setCopiedTopic(i);
      window.setTimeout(() => setCopiedTopic((prev) => (prev === i ? null : prev)), 2000);
    } catch {
      // fallback: niente clipboard API → no-op
    }
  };

  const topics = sm.topics ?? [];
  const hasDecisions = (sm.key_decisions ?? []).length > 0;
  const hasActions = (sm.action_items ?? []).length > 0;
  const showExpand = hasDecisions || hasActions;

  const seekTo = (mmss: string) => {
    const sec = mmssToSec(mmss);
    if (sec == null) return;
    playerRef?.current?.seekTo?.(sec, true);
  };

  return (
    <section
      className="post-event-hero mb-4"
      aria-labelledby="post-event-hero-title"
    >
      <div
        className="p-4 p-md-4"
        style={{
          borderRadius: 16,
          background:
            'linear-gradient(135deg, #f5f9ff 0%, #ffffff 60%, #eef5ff 100%)',
          border: '1px solid #d6e3f1',
          boxShadow: '0 1px 3px rgba(0,32,80,0.04)',
        }}
      >
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <Badge
            color=""
            pill
            style={{
              background: 'rgba(0,102,204,0.12)',
              color: 'var(--app-primary)',
              fontSize: '0.72rem',
              letterSpacing: 0.3,
              padding: '4px 12px',
              border: '1px solid rgba(0,102,204,0.22)',
              fontWeight: 600,
            }}
          >
            {t('badge')}
          </Badge>
          <Badge
            color=""
            pill
            style={{
              background: 'rgba(120,93,0,0.10)',
              color: '#7A5A00',
              fontSize: '0.68rem',
              letterSpacing: 0.3,
              padding: '4px 10px',
              border: '1px solid rgba(120,93,0,0.18)',
              fontWeight: 500,
            }}
          >
            {t('aiActArt50')}
          </Badge>
          {availableLocales.length > 1 && (
            <label
              className="d-inline-flex align-items-center gap-2 ms-auto"
              style={{ fontSize: '0.78rem', color: 'var(--app-muted)' }}
            >
              <span>{t('summaryLanguageLabel')}</span>
              <select
                className="form-control form-control-sm"
                style={{
                  width: 'auto',
                  fontSize: '0.85rem',
                  background: 'white',
                  border: '1px solid #c9d4de',
                  padding: '4px 28px 4px 10px',
                }}
                value={lang}
                onChange={(e) => onLangChange(e.target.value)}
                aria-label={t('summaryLanguageLabel')}
              >
                {availableLocales.map((l) => (
                  <option key={l} value={l}>
                    {localeDisplayName(l, lang).replace(/^./, (c) => c.toUpperCase())}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <h2
          id="post-event-hero-title"
          className="h4 fw-semibold mb-2"
          style={{ color: 'var(--app-text)' }}
        >
          {t('title')}
        </h2>

        {sm.overall_summary && (
          <p
            className="mb-3"
            style={{
              color: '#26354A',
              fontSize: '1rem',
              lineHeight: 1.55,
            }}
          >
            {sm.overall_summary}
          </p>
        )}

        {/* Topic navigator chips */}
        {topics.length > 0 && (
          <div className="mb-3">
            <div
              className="text-uppercase fw-semibold text-muted mb-2"
              style={{ fontSize: '0.72rem', letterSpacing: 0.6 }}
            >
              {t('topicsLabel')}
            </div>
            <div className="d-flex flex-wrap gap-2">
              {topics.map((tp, i) => {
                const stamp = tp.start_mmss ?? '';
                const seekable = !!stamp && mmssToSec(stamp) != null;
                const palette = speakerColor(`topic:${i}:${tp.title ?? ''}`);
                const isCopied = copiedTopic === i;
                const isLive = i === activeTopicIdx;
                return (
                  <div
                    key={`${i}-${tp.title ?? ''}`}
                    className="d-inline-flex align-items-center"
                    style={{
                      background: isLive ? palette.color + '24' : palette.bg,
                      border: `1px solid ${isLive ? palette.color : palette.color + '33'}`,
                      borderRadius: 999,
                      transition: 'transform 0.12s, box-shadow 0.12s, border 0.12s, background 0.12s',
                      boxShadow: isLive ? `0 0 0 3px ${palette.color}22` : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!seekable) return;
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = `0 3px 8px ${palette.color}33`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = isLive ? `0 0 0 3px ${palette.color}22` : '';
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => stamp && seekTo(stamp)}
                      disabled={!seekable}
                      className="btn p-0 d-inline-flex align-items-center gap-2"
                      style={{
                        background: 'transparent',
                        color: palette.color,
                        border: 'none',
                        borderRadius: 999,
                        padding: '5px 4px 5px 6px',
                        fontSize: '0.85rem',
                        lineHeight: 1.2,
                        cursor: seekable ? 'pointer' : 'default',
                      }}
                      title={tp.summary ?? ''}
                      aria-label={`${tp.title ?? ''} ${stamp ? `(${stamp})` : ''}`}
                    >
                      <span
                        className="d-inline-flex align-items-center justify-content-center"
                        style={{
                          background: palette.color,
                          color: 'white',
                          borderRadius: 999,
                          width: 28,
                          height: 22,
                          fontSize: '0.7rem',
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: 600,
                        }}
                      >
                        {stamp || `T${i + 1}`}
                      </span>
                      <span className="fw-medium">{tp.title ?? `Topic ${i + 1}`}</span>
                    </button>
                    {seekable && eventSlug && (
                      <button
                        type="button"
                        onClick={() => shareTopic(i, stamp)}
                        className="btn p-0 d-inline-flex align-items-center justify-content-center"
                        title={isCopied ? tShare('shareSegmentCopied') : tShare('shareSegment')}
                        aria-label={isCopied ? tShare('shareSegmentCopied') : tShare('shareSegment')}
                        style={{
                          background: 'transparent',
                          color: palette.color,
                          border: 'none',
                          borderLeft: `1px solid ${palette.color}33`,
                          marginLeft: 4,
                          width: 30,
                          height: 24,
                          borderRadius: 999,
                          cursor: 'pointer',
                          opacity: isCopied ? 1 : 0.65,
                          fontSize: 14,
                        }}
                      >
                        <Icon
                          icon={isCopied ? 'it-check' : 'it-link'}
                          size="sm"
                          color={undefined}
                        />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Decisions + actions (collapse default per non occupare troppo schermo) */}
        {showExpand && (
          <>
            {expanded && (
              <div className="row g-3 mt-2">
                {hasDecisions && (
                  <div className="col-md-6">
                    <DecisionBlock
                      title={t('keyDecisions')}
                      items={sm.key_decisions!}
                      color="#0066CC"
                      icon="it-check"
                    />
                  </div>
                )}
                {hasActions && (
                  <div className="col-md-6">
                    <DecisionBlock
                      title={t('actionItems')}
                      items={sm.action_items!}
                      color="#008758"
                      icon="it-pencil"
                    />
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className="btn btn-link p-0 mt-3 d-inline-flex align-items-center gap-1"
              style={{ fontSize: '0.85rem' }}
              onClick={() => {
                setExpanded((v) => !v);
                if (!expanded) onExpand?.();
              }}
              aria-expanded={expanded}
            >
              <Icon icon={expanded ? 'it-collapse' : 'it-expand'} size="sm" />
              {expanded ? t('collapseDetails') : t('expandDetails')}
            </button>
          </>
        )}

        {/* Trasparenza del processing AI — link sobrio in fondo all'hero.
            Il pannello si apre inline, sotto la sintesi. */}
        {pipelineSnapshot && (
          <div
            className="mt-3 pt-3"
            style={{ borderTop: '1px solid #e3eaf1' }}
          >
            <PipelineProvenance
              snapshot={pipelineSnapshot}
              locale={preferredLocale}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionBlock({
  title,
  items,
  color,
  icon,
}: {
  title: string;
  items: string[];
  color: string;
  icon: string;
}) {
  return (
    <div
      className="p-3"
      style={{
        background: 'white',
        borderRadius: 10,
        border: '1px solid #e3eaf1',
      }}
    >
      <div
        className="d-flex align-items-center gap-2 mb-2 text-uppercase fw-semibold"
        style={{ fontSize: '0.72rem', letterSpacing: 0.6, color }}
      >
        <Icon icon={icon} size="sm" />
        {title}
      </div>
      <ul className="mb-0 ps-3" style={{ fontSize: '0.92rem', lineHeight: 1.5 }}>
        {items.map((it, i) => (
          <li key={i} style={{ color: '#26354A' }}>{it}</li>
        ))}
      </ul>
    </div>
  );
}
