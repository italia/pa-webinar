'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Button,
  Badge,
  Icon,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'design-react-kit';

import type { JitsiMeetExternalAPI } from '@/types/jitsi';
import { useJitsiEvents } from '@/hooks/use-jitsi-events';
import { useRouter } from '@/i18n/navigation';

import RaisedHandsPanel from './raised-hands-panel';

interface ModeratorControlsProps {
  api: JitsiMeetExternalAPI | null;
  eventId: string;
  moderatorToken: string;
  recordingEnabled: boolean;
}

export default function ModeratorControls({
  api,
  eventId,
  moderatorToken,
  recordingEnabled,
}: ModeratorControlsProps) {
  const t = useTranslations('live.moderator');
  const tc = useTranslations('common');
  const router = useRouter();

  const { participantCount, isRecording } = useJitsiEvents(api);

  const [chatOpen, setChatOpen] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showHands, setShowHands] = useState(false);

  // Recording elapsed timer
  const [recSeconds, setRecSeconds] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isRecording) {
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => {
        setRecSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      setRecSeconds(0);
    }
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, [isRecording]);

  const formatTime = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleMuteAll = useCallback(() => {
    api?.executeCommand('muteEveryone');
  }, [api]);

  const handleToggleRecording = useCallback(() => {
    if (!api) return;
    if (isRecording) {
      api.executeCommand('stopRecording', 'file');
    } else {
      api.executeCommand('startRecording', { mode: 'file' });
    }
  }, [api, isRecording]);

  const handleToggleChat = useCallback(() => {
    api?.executeCommand('toggleChat');
    setChatOpen((o) => !o);
  }, [api]);

  const handleEndEvent = useCallback(async () => {
    setEnding(true);
    try {
      api?.executeCommand('hangup');

      await fetch(`/api/events/${eventId}?token=${moderatorToken}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ENDED' }),
      });

      setEndModalOpen(false);

      setTimeout(() => {
        router.push(`/admin/eventi/${eventId}?token=${moderatorToken}`);
      }, 2000);
    } catch {
      setEnding(false);
    }
  }, [api, eventId, moderatorToken, router]);

  return (
    <>
      <div className="bg-dark text-white px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Button
            color="light"
            outline
            size="sm"
            onClick={handleMuteAll}
            disabled={!api}
          >
            <Icon icon="it-hearing" size="sm" className="me-1" />
            {t('muteAll')}
          </Button>

          {recordingEnabled && (
            <Button
              color={isRecording ? 'danger' : 'light'}
              outline={!isRecording}
              size="sm"
              onClick={handleToggleRecording}
              disabled={!api}
            >
              <Icon icon="it-video" size="sm" className="me-1" />
              {isRecording ? t('stopRecording') : t('startRecording')}
              {isRecording && (
                <Badge color="light" pill className="ms-2 text-danger px-2">
                  {formatTime(recSeconds)}
                </Badge>
              )}
            </Button>
          )}

          <Button
            color={chatOpen ? 'info' : 'light'}
            outline={!chatOpen}
            size="sm"
            onClick={handleToggleChat}
            disabled={!api}
          >
            <Icon icon="it-comment" size="sm" className="me-1" />
            {t('toggleChat')}
          </Button>

          <Button
            color="light"
            outline
            size="sm"
            onClick={() => setShowHands(!showHands)}
            disabled={!api}
          >
            <Icon icon="it-hand" size="sm" className="me-1" />
            {t('raisedHands')}
          </Button>

          <Button
            color="danger"
            size="sm"
            onClick={() => setEndModalOpen(true)}
          >
            <Icon icon="it-close-circle" size="sm" className="me-1" />
            {t('endEvent')}
          </Button>
        </div>

        <div className="d-flex align-items-center gap-2">
          <Badge color="light" pill className="text-dark px-2 py-1">
            <Icon icon="it-user" size="xs" className="me-1" />
            {t('participantCount', { count: participantCount })}
          </Badge>
        </div>
      </div>

      {showHands && (
        <RaisedHandsPanel api={api} />
      )}

      <Modal
        isOpen={endModalOpen}
        toggle={() => setEndModalOpen(false)}
        centered
      >
        <ModalHeader toggle={() => setEndModalOpen(false)}>
          {t('endEvent')}
        </ModalHeader>
        <ModalBody>
          <p>{t('endEventConfirm')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => setEndModalOpen(false)}
            disabled={ending}
          >
            {tc('cancel')}
          </Button>
          <Button color="danger" onClick={handleEndEvent} disabled={ending}>
            {ending ? tc('loading') : tc('confirm')}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
