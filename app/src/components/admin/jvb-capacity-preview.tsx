'use client';

import { useTranslations } from 'next-intl';

import { jvbsForEvent, type JvbSizingConfig } from '@/lib/jvb-sizing';

interface Preset {
  key: 'webinar' | 'meeting' | 'workshop' | 'allHands';
  value: number;
}

const PRESETS: Preset[] = [
  { key: 'webinar', value: 5 },
  { key: 'meeting', value: 30 },
  { key: 'workshop', value: 60 },
  { key: 'allHands', value: 100 },
];

interface Props {
  maxParticipants: number;
  /** null = inherit site default */
  senderRatioPct: number | null;
  onSenderRatioChange: (next: number | null) => void;
  videoEnabled: boolean;
  defaultSenderRatioPct: number;
  sizingConfig: JvbSizingConfig;
  /** Threshold (inclusive) above which we warn if the ratio is inherited. */
  ratioRequiredAboveParticipants?: number;
}

export default function JvbCapacityPreview({
  maxParticipants,
  senderRatioPct,
  onSenderRatioChange,
  videoEnabled,
  defaultSenderRatioPct,
  sizingConfig,
  ratioRequiredAboveParticipants = 100,
}: Props) {
  const t = useTranslations('admin.form.jvbPreview');

  const effectiveRatio = videoEnabled ? (senderRatioPct ?? defaultSenderRatioPct) : 0;
  const pods = jvbsForEvent(
    Math.max(0, maxParticipants),
    effectiveRatio,
    videoEnabled,
    sizingConfig,
  );
  const senders = Math.ceil(maxParticipants * (effectiveRatio / 100));
  const receivers = Math.max(0, maxParticipants - senders);

  const atCeiling = pods >= sizingConfig.maxReplicas && maxParticipants > 0;
  const ratioInherited = senderRatioPct === null;
  const shouldWarnInherited =
    ratioInherited
    && videoEnabled
    && maxParticipants >= ratioRequiredAboveParticipants;

  const containerStyle: React.CSSProperties = {
    backgroundColor: atCeiling ? '#FFF4E5' : '#F0F7FF',
    border: `1px solid ${atCeiling ? '#E68A00' : '#B9D9FB'}`,
    borderRadius: 8,
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
  };

  return (
    <div className="mb-3" style={containerStyle} aria-live="polite">
      <div className="fw-semibold mb-2" style={{ color: 'var(--app-text)' }}>
        {t('title')}
      </div>

      <div className="d-flex flex-wrap gap-3 mb-2">
        <span>
          <strong>{pods}</strong>{' '}
          {pods === 1 ? t('pod') : t('pods')}
          {atCeiling && ` (${t('atCeiling', { max: sizingConfig.maxReplicas })})`}
        </span>
        <span className="text-muted">·</span>
        <span>
          {t('senders')}: <strong>{senders}</strong>
        </span>
        <span className="text-muted">·</span>
        <span>
          {t('receivers')}: <strong>{receivers}</strong>
        </span>
        <span className="text-muted">·</span>
        <span>
          {t('effectiveRatio')}:{' '}
          <strong>{Math.round(effectiveRatio)}%</strong>
          {ratioInherited && videoEnabled && (
            <span className="text-muted ms-1">({t('inherited')})</span>
          )}
        </span>
      </div>

      <div className="d-flex flex-wrap align-items-center gap-2 mb-1">
        <span className="text-muted">{t('presetLabel')}:</span>
        {PRESETS.map((p) => {
          const active = senderRatioPct === p.value;
          return (
            <button
              key={p.key}
              type="button"
              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-primary'}`}
              onClick={() => onSenderRatioChange(p.value)}
              disabled={!videoEnabled}
            >
              {t(`preset.${p.key}`)} {p.value}%
            </button>
          );
        })}
        {!ratioInherited && (
          <button
            type="button"
            className="btn btn-sm btn-link"
            onClick={() => onSenderRatioChange(null)}
          >
            {t('clearPreset')}
          </button>
        )}
      </div>

      {!videoEnabled && (
        <div className="text-muted mt-2" style={{ fontSize: '0.8rem' }}>
          {t('videoDisabled')}
        </div>
      )}

      {shouldWarnInherited && (
        <div
          className="mt-2 p-2"
          style={{
            backgroundColor: '#FFF4E5',
            border: '1px solid #E68A00',
            borderRadius: 4,
            color: '#7A4A00',
            fontSize: '0.85rem',
          }}
        >
          {t('warnInherited', {
            participants: maxParticipants,
            defaultPct: defaultSenderRatioPct,
          })}
        </div>
      )}

      {atCeiling && (
        <div
          className="mt-2 p-2"
          style={{
            backgroundColor: '#FFF4E5',
            border: '1px solid #E68A00',
            borderRadius: 4,
            color: '#7A4A00',
            fontSize: '0.85rem',
          }}
        >
          {t('warnCeiling', { max: sizingConfig.maxReplicas })}
        </div>
      )}
    </div>
  );
}
