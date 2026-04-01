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

const BAR_STYLE: React.CSSProperties = {
  background: '#1a1a2e',
  borderBottom: '1px solid rgba(255,255,255,0.1)',
};

const BTN_BASE = 'py-2 px-3 d-inline-flex align-items-center gap-1 fw-semibold';

export default function ModeratorControls({
  api,
  eventId,
  moderatorToken,
  recordingEnabled,
}: ModeratorControlsProps) {
  const t = useTranslations('live.moderator');
  const tl = useTranslations('live');
  const tc = useTranslations('common');
  const router = useRouter();

  const { participantCount, isRecording } = useJitsiEvents(api);

  const [chatActive, setChatActive] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [handsOpen, setHandsOpen] = useState(false);
  const [handsCount, setHandsCount] = useState(0);
  const [recToast, setRecToast] = useState('');
  const [audioModerationActive, setAudioModerationActive] = useState(false);
  const [videoModerationActive, setVideoModerationActive] = useState(false);

  const [recSeconds, setRecSeconds] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup navigation timer on unmount
  useEffect(() => {
    return () => {
      if (endNavigationTimerRef.current) clearTimeout(endNavigationTimerRef.current);
    };
  }, []);

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
    if (!api) {
      setRecToast(tl('jibriUnavailable'));
      setTimeout(() => setRecToast(''), 3000);
      return;
    }
    try {
      if (isRecording) {
        api.executeCommand('stopRecording', 'file');
      } else {
        api.executeCommand('startRecording', { mode: 'file' });
      }
    } catch {
      setRecToast(tl('jibriUnavailable'));
      setTimeout(() => setRecToast(''), 3000);
    }
  }, [api, isRecording, tl]);

  const handleToggleChat = useCallback(() => {
    api?.executeCommand('toggleChat');
    setChatActive((o) => !o);
  }, [api]);

  const handleToggleAudioModeration = useCallback(() => {
    if (!api) return;
    if (audioModerationActive) {
      api.executeCommand('disableAudioModeration');
    } else {
      api.executeCommand('enableAudioModeration');
    }
    setAudioModerationActive((o) => !o);
  }, [api, audioModerationActive]);

  const handleToggleVideoModeration = useCallback(() => {
    if (!api) return;
    if (videoModerationActive) {
      api.executeCommand('disableVideoModeration');
    } else {
      api.executeCommand('enableVideoModeration');
    }
    setVideoModerationActive((o) => !o);
  }, [api, videoModerationActive]);

  const handleEndEvent = useCallback(async () => {
    setEnding(true);
    try {
      api?.executeCommand('hangup');
      await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({ status: 'ENDED' }),
      });
      setEndModalOpen(false);
      endNavigationTimerRef.current = setTimeout(() => {
        router.push(`/admin/eventi/${eventId}?token=${moderatorToken}`);
      }, 2000);
    } catch {
      setEnding(false);
    }
  }, [api, eventId, moderatorToken, router]);

  const onHandsCountChange = useCallback((count: number) => {
    setHandsCount(count);
  }, []);

  return (
    <>
      <div
        className="text-white px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2"
        style={BAR_STYLE}
      >
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Mute All */}
          <Button
            color="light"
            outline
            size="sm"
            className={BTN_BASE}
            onClick={handleMuteAll}
            disabled={!api}
            style={{ fontSize: '0.82rem' }}
          >
            <Icon icon="it-hearing" size="sm" />
            {t('muteAll')}
          </Button>

          {/* Chat toggle */}
          <Button
            color={chatActive ? 'info' : 'light'}
            outline={!chatActive}
            size="sm"
            className={BTN_BASE}
            onClick={handleToggleChat}
            disabled={!api}
            style={{ fontSize: '0.82rem' }}
          >
            <Icon icon="it-comment" size="sm" />
            {t('toggleChat')}
          </Button>

          {/* Audio moderation */}
          <Button
            color={audioModerationActive ? 'warning' : 'light'}
            outline={!audioModerationActive}
            size="sm"
            className={BTN_BASE}
            onClick={handleToggleAudioModeration}
            disabled={!api}
            style={{ fontSize: '0.82rem' }}
          >
            <Icon icon="it-hearing" size="sm" />
            {t('audioModeration')}
          </Button>

          {/* Video moderation */}
          <Button
            color={videoModerationActive ? 'warning' : 'light'}
            outline={!videoModerationActive}
            size="sm"
            className={BTN_BASE}
            onClick={handleToggleVideoModeration}
            disabled={!api}
            style={{ fontSize: '0.82rem' }}
          >
            <Icon icon="it-video" size="sm" />
            {t('videoModeration')}
          </Button>

          {/* Raised hands */}
          <Button
            color="light"
            outline
            size="sm"
            className={`${BTN_BASE} position-relative`}
            onClick={() => setHandsOpen(!handsOpen)}
            disabled={!api}
            style={{ fontSize: '0.82rem' }}
          >
            <span style={{ fontSize: '1rem' }}>✋</span>
            {t('raisedHands')}
            {handsCount > 0 && (
              <Badge
                color="warning"
                pill
                className="ms-1"
                style={{ fontSize: '0.7rem' }}
              >
                {handsCount}
              </Badge>
            )}
          </Button>

          {/* Recording — only visible when recording is enabled for the event */}
          {recordingEnabled && (
            <Button
              color={isRecording ? 'danger' : 'light'}
              outline={!isRecording}
              size="sm"
              className={BTN_BASE}
              onClick={handleToggleRecording}
              disabled={!api}
              style={{ fontSize: '0.82rem' }}
            >
              {isRecording ? (
                <>
                  <span
                    className="d-inline-block rounded-circle"
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: '#fff',
                      animation: 'pulse-dot 1.5s ease-in-out infinite',
                    }}
                  />
                  {t('stopRecording')}
                  <Badge
                    color="light"
                    pill
                    className="ms-1 text-danger"
                    style={{ fontSize: '0.72rem' }}
                  >
                    {formatTime(recSeconds)}
                  </Badge>
                </>
              ) : (
                <>
                  <Icon icon="it-video" size="sm" />
                  {t('startRecording')}
                </>
              )}
            </Button>
          )}

          {/* End event */}
          <Button
            color="danger"
            size="sm"
            className={BTN_BASE}
            onClick={() => setEndModalOpen(true)}
            style={{ fontSize: '0.82rem' }}
          >
            <Icon icon="it-close-circle" size="sm" color="white" />
            {t('endEvent')}
          </Button>
        </div>

        {/* Participant count */}
        <Badge
          color=""
          pill
          className="px-3 py-1"
          style={{ backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: '0.82rem' }}
        >
          <Icon icon="it-user" size="xs" className="me-1" />
          {t('participantCount', { count: participantCount })}
        </Badge>
      </div>

      {/* Jibri toast */}
      {recToast && (
        <div
          className="bg-warning text-dark px-3 py-2 small text-center fw-semibold"
          role="alert"
        >
          {recToast}
        </div>
      )}

      {/* Raised hands panel — collapsed by default */}
      {handsOpen && (
        <RaisedHandsPanel api={api} onCountChange={onHandsCountChange} />
      )}

      {/* End event confirmation modal */}
      <Modal isOpen={endModalOpen} toggle={() => setEndModalOpen(false)} centered>
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
