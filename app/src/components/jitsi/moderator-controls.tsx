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
  jibriAvailable?: boolean;
}

const BAR_STYLE: React.CSSProperties = {
  background: '#17324D',
  borderBottom: '2px solid #0066CC',
};

const BTN_BASE = 'py-2 px-3 d-inline-flex align-items-center gap-1 fw-semibold border-0 rounded-1';

const BTN_DEFAULT: React.CSSProperties = {
  fontSize: '0.82rem',
  background: '#243B55',
  color: '#C9D4DE',
};

const BTN_ACTIVE_WARN: React.CSSProperties = {
  fontSize: '0.82rem',
  background: '#0066CC',
  color: '#fff',
};

const BTN_DANGER: React.CSSProperties = {
  fontSize: '0.82rem',
};

export default function ModeratorControls({
  api,
  eventId,
  moderatorToken,
  recordingEnabled,
  jibriAvailable = true,
}: ModeratorControlsProps) {
  const t = useTranslations('live.moderator');
  const tl = useTranslations('live');
  const tc = useTranslations('common');
  const router = useRouter();

  const { participantCount, isRecording } = useJitsiEvents(api);

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

  useEffect(() => {
    return () => {
      if (endNavigationTimerRef.current) clearTimeout(endNavigationTimerRef.current);
    };
  }, []);

  // Sync AV moderation state with Jitsi events
  useEffect(() => {
    if (!api) return;
    const onAudioMod = (evt: { enabled: boolean }) => setAudioModerationActive(evt.enabled);
    const onVideoMod = (evt: { enabled: boolean }) => setVideoModerationActive(evt.enabled);
    api.addListener('audioModerationChanged', onAudioMod);
    api.addListener('videoModerationChanged', onVideoMod);
    return () => {
      api.removeListener('audioModerationChanged', onAudioMod);
      api.removeListener('videoModerationChanged', onVideoMod);
    };
  }, [api]);

  // Track raised hands even when panel is closed
  useEffect(() => {
    if (!api) return;
    const raisedIds = new Set<string>();

    const onRaiseHand = (evt: { id: string; handRaised: number }) => {
      if (evt.handRaised > 0) {
        raisedIds.add(evt.id);
      } else {
        raisedIds.delete(evt.id);
      }
      setHandsCount(raisedIds.size);
    };
    const onLeft = (evt: { id: string }) => {
      raisedIds.delete(evt.id);
      setHandsCount(raisedIds.size);
    };

    api.addListener('raiseHandUpdated', onRaiseHand);
    api.addListener('participantLeft', onLeft);
    return () => {
      api.removeListener('raiseHandUpdated', onRaiseHand);
      api.removeListener('participantLeft', onLeft);
    };
  }, [api]);

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

  // Mic toggle: mute everyone + enable audio moderation, or disable moderation
  const handleToggleAudioModeration = useCallback(() => {
    if (!api) return;
    if (audioModerationActive) {
      api.executeCommand('disableAudioModeration');
    } else {
      api.executeCommand('muteEveryone');
      api.executeCommand('enableAudioModeration');
    }
  }, [api, audioModerationActive]);

  const handleToggleVideoModeration = useCallback(() => {
    if (!api) return;
    if (videoModerationActive) {
      api.executeCommand('disableVideoModeration');
    } else {
      api.executeCommand('enableVideoModeration');
    }
  }, [api, videoModerationActive]);

  const handleToggleRecording = useCallback(() => {
    if (!api || !jibriAvailable) {
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
  }, [api, isRecording, tl, jibriAvailable]);

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

  return (
    <>
      <div
        className="text-white px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2 moderator-bar"
        style={BAR_STYLE}
      >
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Audio moderation toggle */}
          <Button
            color={audioModerationActive ? 'warning' : 'secondary'}
            size="sm"
            className={BTN_BASE}
            onClick={handleToggleAudioModeration}
            disabled={!api}
            style={audioModerationActive ? BTN_ACTIVE_WARN : BTN_DEFAULT}
          >
            <Icon icon="it-hearing" size="sm" color="white" />
            {audioModerationActive ? t('micDisabled') : t('audioModeration')}
          </Button>

          {/* Video moderation toggle */}
          <Button
            color={videoModerationActive ? 'warning' : 'secondary'}
            size="sm"
            className={BTN_BASE}
            onClick={handleToggleVideoModeration}
            disabled={!api}
            style={videoModerationActive ? BTN_ACTIVE_WARN : BTN_DEFAULT}
          >
            <Icon icon="it-video" size="sm" color="white" />
            {videoModerationActive ? t('videoDisabled') : t('videoModeration')}
          </Button>

          {/* Raised hands */}
          <Button
            color={handsCount > 0 ? 'warning' : 'secondary'}
            size="sm"
            className={`${BTN_BASE} position-relative`}
            onClick={() => setHandsOpen(!handsOpen)}
            disabled={!api}
            style={handsCount > 0 ? BTN_ACTIVE_WARN : BTN_DEFAULT}
          >
            <span style={{ fontSize: '1rem' }}>&#9995;</span>
            {t('raisedHands')}
            {handsCount > 0 && (
              <Badge
                color="danger"
                pill
                className="ms-1"
                style={{ fontSize: '0.7rem' }}
              >
                {handsCount}
              </Badge>
            )}
          </Button>

          {/* Recording */}
          {recordingEnabled && (
            <Button
              color={isRecording ? 'danger' : 'secondary'}
              size="sm"
              className={BTN_BASE}
              onClick={handleToggleRecording}
              disabled={!api || !jibriAvailable}
              title={!jibriAvailable ? tl('jibriNotConfigured') : undefined}
              style={isRecording ? BTN_DANGER : BTN_DEFAULT}
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
                    color=""
                    pill
                    className="ms-1"
                    style={{ fontSize: '0.72rem', background: 'rgba(255,255,255,0.2)', color: '#fff' }}
                  >
                    {formatTime(recSeconds)}
                  </Badge>
                </>
              ) : (
                <>
                  <Icon icon="it-video" size="sm" color="white" />
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
            style={BTN_DANGER}
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

      {/* Raised hands panel */}
      {handsOpen && (
        <RaisedHandsPanel api={api} />
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
