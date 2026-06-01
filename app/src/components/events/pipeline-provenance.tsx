'use client';

/**
 * Trasparenza del processing AI per una singola registrazione.
 *
 * Mostra al visitatore quali modelli sono stati usati per produrre
 * trascrizione, sintesi, traduzione e doppiaggio di QUESTO video, con
 * versioni e licenze. La sorgente è lo `pipelineSnapshot` salvato sul
 * `Recording` al termine del processing — non le impostazioni correnti
 * del SiteSetting, che potrebbero essere cambiate nel frattempo.
 *
 * Pattern UI:
 *   - in chiusura: piccolo link/badge "Trasparenza del processing"
 *     non invasivo (sotto al video o nell'hero), riconoscibile come
 *     azione "vedi dettagli";
 *   - in apertura: pannello drawer-style con sezioni Trascrizione /
 *     Sintesi / Doppiaggio + lingue + data run. Niente nomi di file
 *     interni, niente env var — descrizioni "umane".
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from 'design-react-kit';

import { speakerColor } from '@/lib/utils/speaker-palette';
import { localeDisplayName } from '@/lib/utils/locale-display';

export interface PipelineSnapshot {
  asr?: {
    engine?: string;
    model?: string;
    version?: string;
    diarization?: {
      engine?: string;
      model?: string;
      method?: string;
      k?: number;
      silhouette?: number;
    };
  };
  llm?: {
    engine?: string;
    model?: string;
    vendor?: string;
    license?: string;
    country?: string;
  };
  tts?: {
    engine?: string;
    license?: string;
    voiceAssignmentPolicy?: string;
  };
  voiceAssignments?: Array<{
    diarLabel?: string;
    displayName?: string | null;
    voiceId?: string;
    gender?: string;
    totalSpeechSec?: number;
  }>;
  languages?: {
    source?: string;
    translation?: string[];
    dubbing?: string[];
  };
  runAt?: string;
  pipelineVersion?: string;
}

interface Props {
  snapshot: PipelineSnapshot | null | undefined;
  /** Locale per Intl.DateTimeFormat sul runAt. */
  locale: string;
}

const hasContent = (s: PipelineSnapshot | null | undefined): s is PipelineSnapshot =>
  !!s && Object.keys(s).length > 0 && !!(s.asr || s.llm || s.tts);

export default function PipelineProvenance({ snapshot, locale }: Props) {
  const t = useTranslations('postprod.provenance');
  const [open, setOpen] = useState(false);
  if (!hasContent(snapshot)) return null;

  const runAt = snapshot.runAt ? new Date(snapshot.runAt) : null;
  const runFmt = runAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(runAt)
    : null;

  const langs = snapshot.languages ?? {};

  return (
    <div className="pipeline-provenance">
      <button
        type="button"
        className="btn p-0 d-inline-flex align-items-center gap-1"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="pipeline-provenance-panel"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#5A768A',
          fontSize: '0.78rem',
          letterSpacing: 0.2,
          textDecoration: 'underline',
          textDecorationStyle: 'dotted',
          textUnderlineOffset: 3,
          cursor: 'pointer',
        }}
      >
        <Icon icon="it-info-circle" size="xs" color={undefined} />
        {open ? t('closeLabel') : t('triggerLabel')}
      </button>

      {open && (
        <div
          id="pipeline-provenance-panel"
          role="region"
          aria-label={t('triggerLabel')}
          className="mt-2"
          style={{
            borderRadius: 12,
            background: 'white',
            border: '1px solid #d6e3f1',
            boxShadow: '0 4px 16px rgba(0,32,80,0.06)',
            padding: 16,
          }}
        >
          <p
            className="text-muted mb-3"
            style={{ fontSize: '0.82rem', lineHeight: 1.5 }}
          >
            {t('intro')}
          </p>

          <div className="row g-3">
            {/* ASR */}
            <ProvBlock
              icon="it-mic"
              title={t('asr.title')}
              hint={t('asr.hint')}
            >
              <KV label={t('asr.engine')} value={snapshot.asr?.engine} />
              <KV label={t('asr.model')} value={snapshot.asr?.model} />
              <KV label={t('asr.version')} value={snapshot.asr?.version} hide={!snapshot.asr?.version} />
              {snapshot.asr?.diarization && (
                <>
                  <KV
                    label={t('asr.diarizationEngine')}
                    value={snapshot.asr.diarization.engine}
                  />
                  <KV
                    label={t('asr.diarizationSpeakers')}
                    value={snapshot.asr.diarization.k?.toString()}
                  />
                </>
              )}
            </ProvBlock>

            {/* LLM */}
            <ProvBlock
              icon="it-presentation"
              title={t('llm.title')}
              hint={t('llm.hint')}
            >
              <KV label={t('llm.model')} value={snapshot.llm?.model} />
              <KV label={t('llm.engine')} value={snapshot.llm?.engine} />
              <KV label={t('llm.vendor')} value={snapshot.llm?.vendor} />
              <KV label={t('llm.license')} value={snapshot.llm?.license} />
              <KV
                label={t('llm.country')}
                value={snapshot.llm?.country}
                hide={!snapshot.llm?.country}
              />
            </ProvBlock>

            {/* TTS */}
            <ProvBlock
              icon="it-volume-high"
              title={t('tts.title')}
              hint={t('tts.hint')}
            >
              <KV label={t('tts.engine')} value={snapshot.tts?.engine} />
              <KV label={t('tts.license')} value={snapshot.tts?.license} />
              <KV
                label={t('tts.policy')}
                value={snapshot.tts?.voiceAssignmentPolicy}
                hide={!snapshot.tts?.voiceAssignmentPolicy}
                multiline
              />
            </ProvBlock>

            {/* Lingue */}
            <ProvBlock
              icon="it-pa"
              title={t('languages.title')}
              hint={t('languages.hint')}
            >
              <KV
                label={t('languages.source')}
                value={langs.source ? localeDisplayName(langs.source, locale) : undefined}
              />
              <KV
                label={t('languages.translation')}
                value={
                  (langs.translation ?? []).length > 0
                    ? langs.translation!
                        .map((l) => localeDisplayName(l, locale))
                        .join(', ')
                    : t('languages.none')
                }
              />
              <KV
                label={t('languages.dubbing')}
                value={
                  (langs.dubbing ?? []).length > 0
                    ? langs.dubbing!
                        .map((l) => localeDisplayName(l, locale))
                        .join(', ')
                    : t('languages.none')
                }
              />
            </ProvBlock>
          </div>

          {/* Voice mapping */}
          {snapshot.voiceAssignments && snapshot.voiceAssignments.length > 0 && (
            <div className="mt-3">
              <div
                className="text-uppercase fw-semibold text-muted mb-2"
                style={{ fontSize: '0.7rem', letterSpacing: 0.6 }}
              >
                {t('voices.title')}
              </div>
              <div className="d-flex flex-wrap gap-2">
                {snapshot.voiceAssignments.map((va, i) => {
                  const id = va.displayName ?? va.diarLabel ?? '—';
                  const palette = speakerColor(id);
                  return (
                    <div
                      key={i}
                      className="d-inline-flex align-items-center gap-2 px-2 py-1"
                      style={{
                        background: palette.bg,
                        border: `1px solid ${palette.color}33`,
                        borderRadius: 999,
                        fontSize: '0.78rem',
                        color: '#26354A',
                      }}
                      title={
                        va.totalSpeechSec
                          ? `${Math.round(va.totalSpeechSec)}s`
                          : undefined
                      }
                    >
                      <span style={{ color: palette.color, fontWeight: 600 }}>
                        {id}
                      </span>
                      {va.voiceId && (
                        <span style={{ color: '#5A768A' }}>
                          → {va.voiceId}
                        </span>
                      )}
                      {va.gender && va.gender !== 'N' && (
                        <span style={{ color: '#5A768A', fontSize: '0.7rem' }}>
                          {va.gender === 'M' ? t('voices.male') : t('voices.female')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer: run timestamp + pipeline version */}
          <div
            className="mt-3 d-flex flex-wrap gap-3"
            style={{ fontSize: '0.74rem', color: '#5A768A' }}
          >
            {runFmt && (
              <span>
                <Icon icon="it-calendar" size="xs" className="me-1" color={undefined} />
                {t('runAt')}: {runFmt}
              </span>
            )}
            {snapshot.pipelineVersion && (
              <span>
                <Icon icon="it-code-circle" size="xs" className="me-1" color={undefined} />
                {t('version')}: <code>{snapshot.pipelineVersion}</code>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProvBlock({
  icon,
  title,
  hint,
  children,
}: {
  icon: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="col-md-6">
      <div
        className="p-3 h-100"
        style={{
          background: '#f7faff',
          borderRadius: 10,
          border: '1px solid #e3eaf1',
        }}
      >
        <div className="d-flex align-items-center gap-2 mb-1">
          <Icon icon={icon} size="sm" color={undefined} />
          <span className="fw-semibold" style={{ color: '#17324D', fontSize: '0.92rem' }}>
            {title}
          </span>
        </div>
        <div className="text-muted mb-2" style={{ fontSize: '0.76rem', lineHeight: 1.45 }}>
          {hint}
        </div>
        <dl className="mb-0" style={{ fontSize: '0.82rem' }}>
          {children}
        </dl>
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  hide,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  hide?: boolean;
  multiline?: boolean;
}) {
  if (hide || !value) return null;
  return (
    <div
      className="d-flex gap-2 mb-1"
      style={multiline ? { alignItems: 'flex-start' } : { alignItems: 'baseline' }}
    >
      <dt
        className="fw-medium"
        style={{
          color: '#5A768A',
          minWidth: 110,
          fontSize: '0.78rem',
        }}
      >
        {label}
      </dt>
      <dd className="mb-0" style={{ color: '#26354A' }}>
        {value}
      </dd>
    </div>
  );
}
