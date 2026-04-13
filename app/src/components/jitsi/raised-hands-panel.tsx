'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Icon } from 'design-react-kit';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';

interface RaisedHand {
  id: string;
  displayName: string;
  raisedAt: number;
}

interface RaisedHandsPanelProps {
  api: JitsiMeetExternalAPI | null;
}

/**
 * Resolves the display name for a participant, retrying once after a
 * short delay if the initial lookup returns empty (race with MUC presence).
 */
function resolveDisplayName(
  api: JitsiMeetExternalAPI,
  participantId: string,
): string {
  const info = api.getParticipantsInfo();
  const p = info.find((pp) => pp.id === participantId);
  return p?.displayName || p?.formattedDisplayName || '';
}

export default function RaisedHandsPanel({ api }: RaisedHandsPanelProps) {
  const t = useTranslations('live.moderator');
  const [hands, setHands] = useState<RaisedHand[]>([]);
  const handsRef = useRef<Map<string, RaisedHand>>(new Map());
  const [, setTick] = useState(0);

  const syncHands = useCallback(() => {
    const arr = Array.from(handsRef.current.values()).sort(
      (a, b) => a.raisedAt - b.raisedAt,
    );
    setHands(arr);
  }, []);

  useEffect(() => {
    if (!api) return;

    const retryTimers = new Set<ReturnType<typeof setTimeout>>();

    const onRaiseHand = (evt: { id: string; handRaised: number }) => {
      if (evt.handRaised > 0) {
        const name = resolveDisplayName(api, evt.id);
        handsRef.current.set(evt.id, {
          id: evt.id,
          displayName: name,
          raisedAt: Date.now(),
        });
        syncHands();

        // If name was empty, retry after MUC presence propagates
        if (!name) {
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            const entry = handsRef.current.get(evt.id);
            if (entry && !entry.displayName) {
              const retried = resolveDisplayName(api, evt.id);
              if (retried) {
                handsRef.current.set(evt.id, { ...entry, displayName: retried });
                syncHands();
              }
            }
          }, 500);
          retryTimers.add(timer);
        }
      } else {
        handsRef.current.delete(evt.id);
        syncHands();
      }
    };

    const onParticipantLeft = (evt: { id: string }) => {
      handsRef.current.delete(evt.id);
      syncHands();
    };

    // Update display names when they change (handles late JWT propagation)
    const onDisplayNameChange = (evt: { id: string; displayname: string }) => {
      const entry = handsRef.current.get(evt.id);
      if (entry && evt.displayname) {
        handsRef.current.set(evt.id, { ...entry, displayName: evt.displayname });
        syncHands();
      }
    };

    api.addListener('raiseHandUpdated', onRaiseHand);
    api.addListener('participantLeft', onParticipantLeft);
    api.addListener('displayNameChange', onDisplayNameChange);

    return () => {
      retryTimers.forEach(clearTimeout);
      retryTimers.clear();
      api.removeListener('raiseHandUpdated', onRaiseHand);
      api.removeListener('participantLeft', onParticipantLeft);
      api.removeListener('displayNameChange', onDisplayNameChange);
    };
  }, [api, syncHands]);

  // Refresh elapsed-time display periodically
  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleApproveAll = useCallback(
    (id: string) => {
      if (!api) return;
      api.executeCommand('askToUnmute', id);
      api.executeCommand('approveVideo', id);
    },
    [api],
  );

  const handleApproveAudioOnly = useCallback(
    (id: string) => {
      if (!api) return;
      api.executeCommand('askToUnmute', id);
    },
    [api],
  );

  if (hands.length === 0) {
    return (
      <div
        className="text-white px-3 py-2 small text-center"
        style={{ background: 'rgba(26,26,46,0.85)' }}
      >
        {t('noRaisedHands')}
      </div>
    );
  }

  return (
    <div
      className="text-white px-3 py-2"
      style={{ background: 'rgba(26,26,46,0.85)' }}
    >
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {hands.map((h) => {
          const elapsed = Math.floor((Date.now() - h.raisedAt) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          return (
            <div
              key={h.id}
              className="d-flex align-items-center gap-1 rounded px-2 py-1"
              style={{ backgroundColor: 'rgba(255,193,7,0.2)' }}
            >
              <span style={{ fontSize: '0.9rem' }}>&#9995;</span>
              <span className="small fw-semibold">
                {h.displayName || t('participantFallback')}
              </span>
              <span className="small" style={{ color: 'rgba(255,255,255,0.6)' }}>
                ({timeStr})
              </span>
              <Button
                color="success"
                size="xs"
                className="px-1 py-0 ms-1"
                onClick={() => handleApproveAll(h.id)}
                aria-label={t('approveAll')}
                title={t('approveAll')}
                style={{ lineHeight: 1 }}
              >
                <Icon icon="it-microphone" size="xs" />
              </Button>
              <Button
                color="light"
                size="xs"
                className="px-1 py-0"
                onClick={() => handleApproveAudioOnly(h.id)}
                aria-label={t('audioOnly')}
                title={t('audioOnly')}
                style={{ lineHeight: 1, fontSize: '0.65rem' }}
              >
                <Icon icon="it-hearing" size="xs" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
