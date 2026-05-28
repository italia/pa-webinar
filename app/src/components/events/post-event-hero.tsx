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

import { useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Icon } from 'design-react-kit';

import type { VideoPlayerHandle } from '@/components/events/video-player';
import { speakerColor } from '@/lib/utils/speaker-palette';

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
  /** Hook quando il visitatore espande "vedi tutto" (analytics opzionale). */
  onExpand?: () => void;
}

const mmssToSec = (mmss: string): number | null => {
  const m = mmss.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

export default function PostEventHero({
  structured,
  preferredLocale,
  playerRef,
  onExpand,
}: Props) {
  const t = useTranslations('postprod.hero');
  const [expanded, setExpanded] = useState(false);

  const availableLocales = Object.keys(structured);
  if (availableLocales.length === 0) return null;
  const lang = availableLocales.includes(preferredLocale)
    ? preferredLocale
    : availableLocales[0]!;
  const sm = structured[lang]!;

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
              background: '#0066CC',
              color: 'white',
              fontSize: '0.7rem',
              letterSpacing: 0.4,
            }}
          >
            <Icon icon="it-presentation" size="xs" className="me-1" color="white" />
            {t('badge')}
          </Badge>
          <Badge
            color=""
            pill
            style={{
              background: '#FFD96B',
              color: '#5C4400',
              fontSize: '0.68rem',
              letterSpacing: 0.4,
            }}
          >
            {t('aiActArt50')}
          </Badge>
          {availableLocales.length > 1 && (
            <span className="text-muted ms-auto" style={{ fontSize: '0.78rem' }}>
              {t('availableIn', { langs: availableLocales.map((l) => l.toUpperCase()).join(', ') })}
            </span>
          )}
        </div>

        <h2
          id="post-event-hero-title"
          className="h4 fw-semibold mb-2"
          style={{ color: '#17324D' }}
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
                const seekable = stamp && mmssToSec(stamp) != null;
                const palette = speakerColor(`topic:${i}:${tp.title ?? ''}`);
                return (
                  <button
                    key={`${i}-${tp.title ?? ''}`}
                    type="button"
                    onClick={() => stamp && seekTo(stamp)}
                    disabled={!seekable}
                    className="btn p-0 d-inline-flex align-items-center gap-2"
                    style={{
                      background: palette.bg,
                      color: palette.color,
                      border: `1px solid ${palette.color}33`,
                      borderRadius: 999,
                      padding: '5px 12px 5px 6px',
                      fontSize: '0.85rem',
                      lineHeight: 1.2,
                      cursor: seekable ? 'pointer' : 'default',
                      transition: 'transform 0.12s, box-shadow 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      if (!seekable) return;
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = `0 3px 8px ${palette.color}33`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = '';
                      e.currentTarget.style.boxShadow = '';
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
