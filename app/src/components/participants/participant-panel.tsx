'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Icon } from 'design-react-kit';

import type { JitsiMeetExternalAPI, JitsiParticipant } from '@/types/jitsi';
import { useJitsiStats, qualityLabel, qualityColor } from '@/hooks/use-jitsi-stats';
import { isHumanParticipant, participantIdentityKey } from '@/lib/jitsi/participants';

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
  // F12: per-participant LOCAL playback volume (0..1, default 1 = 100%) and
  // which row currently has its slider expanded. Kept separate from
  // `participants` so the 5s roster refresh never resets a user's choices.
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [openVolumeId, setOpenVolumeId] = useState<string | null>(null);
  const stats = useJitsiStats(api);

  const refresh = useCallback(() => {
    if (!api) return;
    // Show EVERY human endpoint (F2: minus the recorder bot). We deliberately
    // do NOT hide same-named connections from the roster — a moderator must be
    // able to see and kick every participant, and two distinct people can share
    // a name. But we REPORT a de-duplicated people-count (F4) so the header
    // matches the "N persone" pill: a person who re-entered (leftover "zombie"
    // endpoint from a Back-button rejoin) is counted once.
    const list = api.getParticipantsInfo().filter(isHumanParticipant);
    setParticipants(list);
    const seen = new Set<string>();
    for (const p of list) seen.add(participantIdentityKey(p) || `#${p.id}`);
    onCountChange?.(seen.size);
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

  // F12: setParticipantVolume adjusts a remote participant's audio *for this
  // browser only* (a local gain on the received track — it never affects what
  // anyone else hears), so it's a per-user preference and is offered to every
  // attendee. Clamp to [0,1] to match the HTMLMediaElement volume range.
  const handleVolume = useCallback(
    (participantId: string, pct: number) => {
      if (!api) return;
      const level = Math.min(1, Math.max(0, pct / 100));
      // Local-only playback gain. Our served Jitsi build implements
      // setParticipantVolume (IFrame API, jitsi-meet PR #9322); executeCommand
      // dispatches async via postMessage, so there is nothing to try/catch here.
      // Known minor limitation: Jitsi resets a remote track's gain if that
      // participant's audio track is recreated (e.g. they mute→unmute), so the
      // stored value may need to be re-dragged to re-apply.
      api.executeCommand('setParticipantVolume', participantId, level);
      setVolumes((prev) => ({ ...prev, [participantId]: level }));
    },
    [api],
  );

  const roleBadge = (role: string) => {
    if (role === 'moderator') {
      return (
        <Badge color="" pill style={{ fontSize: '0.68rem', backgroundColor: '#E8F0FE', color: 'var(--app-primary)' }}>
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
      {/* Header stays pinned so the title + live count remain visible while
          scrolling a long roster (F2b). */}
      <div
        className="d-flex justify-content-between align-items-center mb-2 pb-2"
        style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}
      >
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
            .map((p) => {
              const vol = volumes[p.id] ?? 1;
              const volPct = Math.round(vol * 100);
              const isVolumeOpen = openVolumeId === p.id;
              const shownName = p.displayName || p.formattedDisplayName || t('anonymous');
              return (
                <div
                  key={p.id}
                  className="rounded px-2 py-1"
                  style={{ backgroundColor: '#f8f9fa', fontSize: '0.85rem' }}
                >
                  <div className="d-flex justify-content-between align-items-center">
                    <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
                      <Icon icon="it-user" size="xs" className="text-muted flex-shrink-0" />
                      <span className="text-truncate fw-semibold" style={{ maxWidth: 140 }}>
                        {shownName}
                      </span>
                      {roleBadge(p.role)}
                    </div>
                    <div className="d-flex gap-2 flex-shrink-0 align-items-center">
                      {/* F12: per-user local playback volume. It only changes what
                          THIS browser hears, so it's offered to every attendee and
                          for every remote endpoint (getParticipantsInfo is
                          remotes-only → the local user is never listed here, so
                          there is no pointless self-control). */}
                      <button
                        type="button"
                        className="btn btn-sm p-0 border-0"
                        onClick={() => setOpenVolumeId(isVolumeOpen ? null : p.id)}
                        title={t('volume')}
                        aria-label={t('volume')}
                        aria-expanded={isVolumeOpen}
                        style={{
                          lineHeight: 1,
                          color: isVolumeOpen
                            ? 'var(--app-primary)'
                            : volPct === 0
                              ? '#dc3545'
                              : '#5a6772',
                        }}
                      >
                        <VolumeGlyph muted={volPct === 0} />
                      </button>
                      {isModerator && p.role !== 'moderator' && (
                        <button
                          type="button"
                          className="btn btn-sm p-0 text-danger border-0"
                          onClick={() => handleKick(p.id)}
                          title={t('kick')}
                          style={{ fontSize: '0.75rem', lineHeight: 1 }}
                        >
                          <Icon icon="it-close-circle" size="xs" />
                        </button>
                      )}
                    </div>
                  </div>
                  {isVolumeOpen && (
                    <div className="d-flex align-items-center gap-2 mt-1">
                      <input
                        type="range"
                        className="form-range"
                        min={0}
                        max={100}
                        step={5}
                        value={volPct}
                        onChange={(e) => handleVolume(p.id, Number(e.target.value))}
                        aria-label={t('volumeFor', { name: shownName })}
                        style={{ flex: 1 }}
                      />
                      <span
                        className="text-muted text-end"
                        style={{ fontSize: '0.72rem', width: 36 }}
                      >
                        {volPct}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

/** Feather-style speaker glyph. Bootstrap Italia has no volume icon, and inline
 *  SVG avoids the design-react-kit <Icon> hydration cost on a per-row control. */
function VolumeGlyph({ muted }: { muted: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 5 6 9H2v6h4l5 4V5z" />
      {muted ? (
        <>
          <line x1="22" y1="9" x2="16" y2="15" />
          <line x1="16" y1="9" x2="22" y2="15" />
        </>
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}
