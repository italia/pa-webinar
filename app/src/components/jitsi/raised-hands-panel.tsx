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
  onCountChange?: (count: number) => void;
}

export default function RaisedHandsPanel({ api, onCountChange }: RaisedHandsPanelProps) {
  const t = useTranslations('live.moderator');
  const [hands, setHands] = useState<RaisedHand[]>([]);
  const handsRef = useRef<Map<string, RaisedHand>>(new Map());
  const [, setTick] = useState(0);

  const syncHands = useCallback(() => {
    const arr = Array.from(handsRef.current.values()).sort(
      (a, b) => a.raisedAt - b.raisedAt,
    );
    setHands(arr);
    onCountChange?.(arr.length);
  }, [onCountChange]);

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

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, []);

  const handleGiveFloor = useCallback(
    (id: string) => {
      void id;
    },
    [],
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
              <span style={{ fontSize: '0.9rem' }}>✋</span>
              <span className="small fw-semibold">{h.displayName}</span>
              <span className="small" style={{ color: 'rgba(255,255,255,0.6)' }}>
                ({timeStr})
              </span>
              <Button
                color="light"
                size="xs"
                className="px-1 py-0 ms-1"
                onClick={() => handleGiveFloor(h.id)}
                aria-label={t('giveFloor')}
                style={{ lineHeight: 1 }}
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
