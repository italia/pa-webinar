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
  Spinner,
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
  participantsCanUnmute?: boolean;
  participantsCanStartVideo?: boolean;
  /** Local moderator's display name, forwarded to the raised-hands panel
   *  so it can resolve the current user's own raise-hand event. */
  localDisplayName?: string;
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
  participantsCanUnmute = false,
  participantsCanStartVideo = false,
  localDisplayName = '',
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
  const [recCooldown, setRecCooldown] = useState(false);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const endNavigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (endNavigationTimerRef.current) clearTimeout(endNavigationTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    const onModerationChanged = (evt: { enabled: boolean; mediaType: string }) => {
      if (evt.mediaType === 'audio') setAudioModerationActive(evt.enabled);
      if (evt.mediaType === 'video') setVideoModerationActive(evt.enabled);
    };
    api.addListener('moderationStatusChanged', onModerationChanged);
    return () => {
      api.removeListener('moderationStatusChanged', onModerationChanged);
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

  const handleToggleAudioModeration = useCallback(() => {
    if (!api) return;
    if (audioModerationActive) {
      api.executeCommand('toggleModeration', false, 'audio');
    } else {
      api.executeCommand('muteEveryone');
      api.executeCommand('toggleModeration', true, 'audio');
    }
  }, [api, audioModerationActive]);

  const handleToggleVideoModeration = useCallback(() => {
    if (!api) return;
    api.executeCommand('toggleModeration', !videoModerationActive, 'video');
  }, [api, videoModerationActive]);

  const recRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recAttemptsRef = useRef(0);
  const MAX_REC_RETRIES = 3;
  const REC_RETRY_DELAY_MS = 3000;

  useEffect(() => {
    return () => {
      if (recRetryRef.current) clearTimeout(recRetryRef.current);
    };
  }, []);

  const attemptStartRecording = useCallback(() => {
    if (!api) return;
    try {
      api.executeCommand('startRecording', { mode: 'file' });
    } catch {
      // Jibri not yet in MUC — schedule retry with backoff
      if (recAttemptsRef.current < MAX_REC_RETRIES) {
        recAttemptsRef.current += 1;
        const delay = REC_RETRY_DELAY_MS * recAttemptsRef.current;
        recRetryRef.current = setTimeout(attemptStartRecording, delay);
      } else {
        recAttemptsRef.current = 0;
        setRecToast(tl('jibriUnavailable'));
        setTimeout(() => setRecToast(''), 4000);
      }
    }
  }, [api, tl]);

  // Listen for recording errors (service-unavailable) and auto-retry
  useEffect(() => {
    if (!api) return;
    const onRecordingLinkUpdate = (evt: { error?: string; on?: boolean }) => {
      if (evt.error && recAttemptsRef.current < MAX_REC_RETRIES) {
        recAttemptsRef.current += 1;
        const delay = REC_RETRY_DELAY_MS * recAttemptsRef.current;
        if (recRetryRef.current) clearTimeout(recRetryRef.current);
        recRetryRef.current = setTimeout(attemptStartRecording, delay);
      } else if (evt.error) {
        recAttemptsRef.current = 0;
        setRecToast(tl('jibriUnavailable'));
        setTimeout(() => setRecToast(''), 4000);
      } else if (evt.on !== undefined) {
        recAttemptsRef.current = 0;
      }
    };
    api.addListener('recordingStatusChanged', onRecordingLinkUpdate);
    return () => {
      api.removeListener('recordingStatusChanged', onRecordingLinkUpdate);
    };
  }, [api, attemptStartRecording, tl]);

  const handleToggleRecording = useCallback(() => {
    if (!api || !jibriAvailable || recCooldown) {
      if (!recCooldown) {
        setRecToast(tl('jibriUnavailable'));
        setTimeout(() => setRecToast(''), 3000);
      }
      return;
    }
    if (isRecording) {
      api.executeCommand('stopRecording', 'file');
      setRecCooldown(true);
      setTimeout(() => setRecCooldown(false), 8000);
    } else {
      recAttemptsRef.current = 0;
      attemptStartRecording();
    }
  }, [api, isRecording, tl, jibriAvailable, recCooldown, attemptStartRecording]);

  const handleEndEvent = useCallback(async () => {
    setEnding(true);
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${moderatorToken}`,
        },
        body: JSON.stringify({ status: 'ENDED' }),
      });
      if (!res.ok) {
        setEnding(false);
        setRecToast(tl('endEventError'));
        setTimeout(() => setRecToast(''), 4000);
        return;
      }
      api?.executeCommand('hangup');
      setEndModalOpen(false);
      endNavigationTimerRef.current = setTimeout(() => {
        router.push(`/admin/events/${eventId}?token=${moderatorToken}`);
      }, 2000);
    } catch {
      setEnding(false);
      setRecToast(tl('endEventError'));
      setTimeout(() => setRecToast(''), 4000);
    }
  }, [api, eventId, moderatorToken, router, tl]);

  return (
    <>
      <div
        className="text-white px-3 py-2 d-flex align-items-center justify-content-between flex-wrap gap-2 moderator-bar"
        style={BAR_STYLE}
      >
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {/* Audio moderation — only when participants have mic access */}
          {participantsCanUnmute && (
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
          )}

          {/* Video moderation — only when participants have camera access */}
          {participantsCanStartVideo && (
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
          )}

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
            jibriAvailable ? (
              <Button
                color={isRecording ? 'danger' : 'secondary'}
                size="sm"
                className={BTN_BASE}
                onClick={handleToggleRecording}
                disabled={!api || recCooldown}
                style={isRecording ? BTN_DANGER : BTN_DEFAULT}
              >
                {recCooldown ? (
                  <>
                    <Icon icon="it-refresh" size="sm" color="white" />
                    {t('recPreparing')}
                  </>
                ) : isRecording ? (
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
            ) : (
              <Button
                color="secondary"
                size="sm"
                className={BTN_BASE}
                disabled
                style={{ ...BTN_DEFAULT, opacity: 0.6 }}
                title={tl('jibriScalingTooltip')}
              >
                <Spinner active small className="me-1" style={{ width: 14, height: 14 }} />
                {tl('jibriScaling')}
              </Button>
            )
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
        <RaisedHandsPanel api={api} localDisplayName={localDisplayName} />
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
