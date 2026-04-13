'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Icon } from 'design-react-kit';

import type { JitsiMeetExternalAPI, JitsiParticipant } from '@/types/jitsi';
import { useJitsiStats, qualityLabel, qualityColor } from '@/hooks/use-jitsi-stats';

interface ParticipantPanelProps {
  api: JitsiMeetExternalAPI | null;
  isModerator: boolean;
  onCountChange?: (count: number) => void;
}

export default function ParticipantPanel({
  api,
  isModerator,
  onCountChange,
}: ParticipantPanelProps) {
  const t = useTranslations('live.participants');
  const tr = useTranslations('live.role');
  const [participants, setParticipants] = useState<JitsiParticipant[]>([]);
  const stats = useJitsiStats(api);

  const refresh = useCallback(() => {
    if (!api) return;
    const list = api.getParticipantsInfo();
    setParticipants(list);
    onCountChange?.(list.length);
  }, [api, onCountChange]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Also refresh on join/leave/name-change events
  useEffect(() => {
    if (!api) return;
    const onJoin = () => refresh();
    const onLeft = () => refresh();
    const onNameChange = () => refresh();
    api.addListener('participantJoined', onJoin);
    api.addListener('participantLeft', onLeft);
    api.addListener('displayNameChange', onNameChange);
    return () => {
      api.removeListener('participantJoined', onJoin);
      api.removeListener('participantLeft', onLeft);
      api.removeListener('displayNameChange', onNameChange);
    };
  }, [api, refresh]);

  const handleKick = useCallback(
    (participantId: string) => {
      if (!api) return;
      if (!confirm(t('kickConfirm'))) return;
      api.executeCommand('kickParticipant', participantId);
    },
    [api, t],
  );

  const roleBadge = (role: string) => {
    if (role === 'moderator') {
      return (
        <Badge color="" pill style={{ fontSize: '0.68rem', backgroundColor: '#E8F0FE', color: '#0066CC' }}>
          {tr('moderator')}
        </Badge>
      );
    }
    return (
      <Badge color="" pill style={{ fontSize: '0.68rem', backgroundColor: '#D4EDDA', color: '#155724' }}>
        {tr('participant')}
      </Badge>
    );
  };

  return (
    <div className="p-2">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h6 className="mb-0 fw-semibold" style={{ fontSize: '0.9rem' }}>
          {t('title')}
        </h6>
        <Badge color="primary" pill style={{ fontSize: '0.75rem' }}>
          {participants.length}
        </Badge>
      </div>

      {/* Connection quality indicator */}
      {isModerator && stats.connectionQuality !== null && (
        <div
          className="d-flex align-items-center gap-2 rounded px-2 py-1 mb-2"
          style={{ backgroundColor: '#f0f4f8', fontSize: '0.78rem' }}
        >
          <span
            className="d-inline-block rounded-circle"
            style={{
              width: 8,
              height: 8,
              backgroundColor: qualityColor(stats.connectionQuality),
            }}
          />
          <span className="fw-semibold">{t('connectionQuality')}</span>
          <span style={{ color: qualityColor(stats.connectionQuality) }}>
            {t(`quality.${qualityLabel(stats.connectionQuality)}`)}
          </span>
          {stats.downloadBitrate !== null && (
            <span className="text-muted ms-auto">
              ↓{Math.round(stats.downloadBitrate)}
              {stats.uploadBitrate !== null && <>  ↑{Math.round(stats.uploadBitrate)}</>}
              {' kbps'}
            </span>
          )}
        </div>
      )}

      {participants.length === 0 ? (
        <div className="text-center text-muted py-3" style={{ fontSize: '0.85rem' }}>
          {t('noParticipants')}
        </div>
      ) : (
        <div className="d-flex flex-column gap-1">
          {/* Moderators first, then participants */}
          {participants
            .sort((a, b) => {
              if (a.role === 'moderator' && b.role !== 'moderator') return -1;
              if (a.role !== 'moderator' && b.role === 'moderator') return 1;
              return a.displayName.localeCompare(b.displayName);
            })
            .map((p) => (
              <div
                key={p.id}
                className="d-flex justify-content-between align-items-center rounded px-2 py-1"
                style={{ backgroundColor: '#f8f9fa', fontSize: '0.85rem' }}
              >
                <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                  <Icon icon="it-user" size="xs" className="text-muted flex-shrink-0" />
                  <span className="text-truncate fw-semibold" style={{ maxWidth: 140 }}>
                    {p.displayName || p.formattedDisplayName || t('anonymous')}
                  </span>
                  {roleBadge(p.role)}
                </div>
                {isModerator && p.role !== 'moderator' && (
                  <div className="d-flex gap-1 flex-shrink-0">
                    <button
                      type="button"
                      className="btn btn-sm p-0 text-danger border-0"
                      onClick={() => handleKick(p.id)}
                      title={t('kick')}
                      style={{ fontSize: '0.75rem', lineHeight: 1 }}
                    >
                      <Icon icon="it-close-circle" size="xs" />
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
