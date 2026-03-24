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

    const onRaiseHand = (evt: { id: string; handRaised: number }) => {
      if (evt.handRaised > 0) {
        const participants = api.getParticipantsInfo();
        const p = participants.find((pp) => pp.id === evt.id);
        handsRef.current.set(evt.id, {
          id: evt.id,
          displayName: p?.displayName ?? evt.id,
          raisedAt: Date.now(),
        });
      } else {
        handsRef.current.delete(evt.id);
      }
      syncHands();
    };

    const onParticipantLeft = (evt: { id: string }) => {
      handsRef.current.delete(evt.id);
      syncHands();
    };

    api.addListener('raiseHandUpdated', onRaiseHand);
    api.addListener('participantLeft', onParticipantLeft);

    return () => {
      api.removeListener('raiseHandUpdated', onRaiseHand);
      api.removeListener('participantLeft', onParticipantLeft);
    };
  }, [api, syncHands]);

  // Tick every 10s to update "time since raised"
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleGiveFloor = useCallback(
    (id: string, name: string) => {
      // Unmuting a specific participant requires deeper Jitsi API work; for now this is a placeholder
      void id;
      void name;
    },
    [],
  );

  if (hands.length === 0) {
    return (
      <div className="bg-dark bg-opacity-75 text-white px-3 py-2 small text-center">
        {t('noRaisedHands')}
      </div>
    );
  }

  return (
    <div className="bg-dark bg-opacity-75 text-white px-3 py-2">
      <div className="d-flex flex-wrap gap-2 align-items-center">
        {hands.map((h) => {
          const elapsed = Math.floor((Date.now() - h.raisedAt) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

          return (
            <div
              key={h.id}
              className="d-flex align-items-center gap-1 bg-warning bg-opacity-25 rounded px-2 py-1"
            >
              <Icon icon="it-hand" size="xs" />
              <span className="small fw-semibold">{h.displayName}</span>
              <span className="text-muted small">({timeStr})</span>
              <Button
                color="light"
                size="xs"
                className="px-1 py-0 ms-1"
                onClick={() => handleGiveFloor(h.id, h.displayName)}
                aria-label={t('giveFloor')}
              >
                <Icon icon="it-microphone" size="xs" />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
