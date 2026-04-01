'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Icon,
  Spinner,
} from 'design-react-kit';

import { Link, useRouter } from '@/i18n/navigation';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';
import JitsiRoom from '@/components/jitsi/jitsi-room';
import RecordingConsent, {
  RecordingBanner,
} from '@/components/jitsi/recording-consent';
import ModeratorControls from '@/components/jitsi/moderator-controls';
import QAPanel from '@/components/qa/qa-panel';
import PreJoinScreen from '@/components/live/pre-join-screen';
import GuestJoinForm from '@/components/live/guest-join-form';
import AudioPlayer from '@/components/live/audio-player';

interface EventInfo {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  recordingEnabled: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomAudioUrl: string | null;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
}

interface LiveEventClientProps {
  event: EventInfo;
  token: string;
  isModerator: boolean;
  isGuest?: boolean;
  displayName: string;
  locale: string;
}

type LivePhase =
  | 'waiting'
  | 'guest_join'
  | 'consent_pending'
  | 'pre_join'
  | 'fetching_jwt'
  | 'ready'
  | 'ended'
  | 'error';

interface JitsiCredentials {
  jwt: string;
  roomName: string;
  displayName: string;
  role: string;
}

const JITSI_DOMAIN = process.env.NEXT_PUBLIC_JITSI_DOMAIN ?? 'localhost:8443';

export default function LiveEventClient({
  event,
  token,
  isModerator,
  isGuest = false,
  displayName: initialDisplayName,
  locale,
}: LiveEventClientProps) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const format = useFormatter();
  const router = useRouter();

  const [phase, setPhase] = useState<LivePhase>('waiting');
  const [credentials, setCredentials] = useState<JitsiCredentials | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [jitsiApi, setJitsiApi] = useState<JitsiMeetExternalAPI | null>(null);
  const [chosenName, setChosenName] = useState(initialDisplayName);

  const startsAtMs = new Date(event.startsAt).getTime();
  const [countdown, setCountdown] = useState('');
  const [eventStatus, setEventStatus] = useState(event.status);
  const [startingEvent, setStartingEvent] = useState(false);

  // Determine initial phase
  useEffect(() => {
    if (eventStatus === 'ENDED') {
      setPhase('ended');
      return;
    }

    if (isGuest) {
      if (eventStatus === 'LIVE') {
        setPhase('guest_join');
      } else {
        setPhase('waiting');
      }
      return;
    }

    if (eventStatus === 'LIVE') {
      if (isModerator) {
        setPhase('pre_join');
      } else if (event.recordingEnabled) {
        setPhase('consent_pending');
      } else {
        setPhase('pre_join');
      }
      return;
    }

    setPhase('waiting');
  }, [eventStatus, event.recordingEnabled, isModerator, isGuest]);

  // Countdown timer
  useEffect(() => {
    if (phase !== 'waiting') return;
    function updateCountdown() {
      const diff = startsAtMs - Date.now();
      if (diff <= 0) { setCountdown(''); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      const parts: string[] = [];
      if (days > 0) parts.push(`${days}g`);
      if (hours > 0) parts.push(`${hours}h`);
      parts.push(`${String(minutes).padStart(2, '0')}m`);
      parts.push(`${String(seconds).padStart(2, '0')}s`);
      setCountdown(parts.join(' '));
    }
    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [phase, startsAtMs]);

  // Poll event status in waiting room
  useEffect(() => {
    if (phase !== 'waiting') return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status && data.status !== eventStatus) {
          setEventStatus(data.status);
        }
      } catch { /* retry */ }
    }, 3000);
    return () => clearInterval(pollInterval);
  }, [phase, event.slug, eventStatus]);

  // Fetch JWT
  const fetchJwt = useCallback(async () => {
    setError('');
    try {
      const body: Record<string, string> = {};
      if (isModerator) {
        body.moderatorToken = token;
      } else {
        body.accessToken = token;
      }
      if (chosenName && chosenName !== initialDisplayName) {
        body.displayNameOverride = chosenName;
      }

      const res = await fetch(`/api/events/${event.slug}/jitsi/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t('connectionError'));
        setPhase('error');
        return;
      }

      const data: JitsiCredentials = await res.json();
      setCredentials(data);
      setPhase('ready');
    } catch {
      setError(t('connectionError'));
      setPhase('error');
    }
  }, [event.slug, isModerator, token, chosenName, initialDisplayName, t]);

  useEffect(() => {
    if (phase === 'fetching_jwt') { fetchJwt(); }
  }, [phase, fetchJwt]);

  const handleConsentAccept = useCallback(() => {
    setPhase('pre_join');
  }, []);

  const handleConsentDecline = useCallback(() => {
    router.push(`/eventi/${event.slug}`);
  }, [router, event.slug]);

  const handlePreJoin = useCallback((name: string) => {
    setChosenName(name);
    setPhase('fetching_jwt');
  }, []);

  const handleGuestJoined = useCallback((creds: JitsiCredentials) => {
    setCredentials(creds);
    setChosenName(creds.displayName);
    setPhase('ready');
  }, []);

  const handleJitsiReady = useCallback(() => {}, []);
  const handleJitsiLeft = useCallback(() => { setPhase('ended'); }, []);
  const handleParticipantCountChanged = useCallback((count: number) => { setParticipantCount(count); }, []);
  const handleRecordingStatusChanged = useCallback((recording: boolean) => { setIsRecording(recording); }, []);
  const handleApiReady = useCallback((api: JitsiMeetExternalAPI) => { setJitsiApi(api); }, []);

  const handleLeaveRoom = useCallback(() => {
    if (jitsiApi) {
      jitsiApi.executeCommand('hangup');
    } else {
      setPhase('ended');
    }
  }, [jitsiApi]);

  // Moderator: start event
  const handleStartEvent = useCallback(async () => {
    setStartingEvent(true);
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'LIVE' }),
      });
      if (!res.ok) {
        setStartingEvent(false);
        return;
      }
      setEventStatus('LIVE');
    } catch {
      setStartingEvent(false);
    }
  }, [event.id, token]);

  // ── Guest join form (no token, LIVE event) ──
  if (phase === 'guest_join') {
    return (
      <GuestJoinForm
        eventTitle={event.title}
        eventSlug={event.slug}
        onJoined={handleGuestJoined}
      />
    );
  }

  // ── Waiting room ──
  if (phase === 'waiting') {
    return (
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-lg-8 col-xl-6 text-center">
            <Icon icon="it-clock" size="xl" className="text-primary mb-3" />
            <h1 className="h3 mb-3">{event.title}</h1>
            <p className="lead mb-2">{t('eventNotStarted')}</p>
            <p className="text-muted mb-4">
              {t('eventStartsAt', {
                date: format.dateTime(new Date(startsAtMs), {
                  day: 'numeric', month: 'long', year: 'numeric',
                }),
                time: format.dateTime(new Date(startsAtMs), {
                  hour: '2-digit', minute: '2-digit',
                }),
              })}
            </p>

            {countdown && (
              <div
                className="bg-primary text-white rounded-3 p-4 mb-4 d-inline-block"
                style={{ minWidth: '280px' }}
              >
                <div className="small text-uppercase mb-1 opacity-75">{t('countdown')}</div>
                <div className="display-6 fw-bold font-monospace">{countdown}</div>
              </div>
            )}

            {isModerator && (
              <div className="mb-4">
                <Button
                  color="success" size="lg" className="px-5"
                  onClick={handleStartEvent} disabled={startingEvent}
                >
                  {startingEvent ? (
                    <><Spinner active small className="me-2" />{t('startingEvent')}</>
                  ) : (
                    <><Icon icon="it-video" size="sm" color="white" className="me-2" />{t('startEventButton')}</>
                  )}
                </Button>
                <Badge color="info" pill className="ms-3 px-3 py-2">{t('moderatorBadge')}</Badge>
              </div>
            )}

            <div className="mb-4 d-flex justify-content-center">
              <AudioPlayer audioUrl={event.waitingRoomAudioUrl} />
            </div>

            <Alert color="info" className="text-start">
              <Icon icon="it-info-circle" className="me-2" />
              {t('waitingRoomHint')}
            </Alert>

            <div className="mt-4">
              <Link href={`/eventi/${event.slug}`}>
                <Button color="primary" outline tag="span">{tc('back')}</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Ended ──
  if (phase === 'ended') {
    return (
      <div className="container py-5 text-center">
        <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
        <h1 className="h3 mb-3">{t('eventEnded')}</h1>
        <p className="mb-4">{t('eventEndedMessage')}</p>
        {isModerator ? (
          <Link href={`/admin/eventi/${event.id}?token=${token}`}>
            <Button color="primary" outline tag="span">{tc('back')}</Button>
          </Link>
        ) : (
          <Link href={`/eventi/${event.slug}`}>
            <Button color="primary" outline tag="span">{t('backToEvent')}</Button>
          </Link>
        )}
      </div>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="container py-5">
        <Alert color="danger">
          <Icon icon="it-close-circle" className="me-2" />
          {error || t('connectionError')}
        </Alert>
        <div className="text-center mt-3">
          <Button color="primary" onClick={() => setPhase('fetching_jwt')} className="me-3">{tc('retry')}</Button>
          <Link href={`/eventi/${event.slug}`}>
            <Button color="secondary" outline tag="span">{t('backToEvent')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Recording consent ──
  if (phase === 'consent_pending') {
    return (
      <>
        <LiveTopBar title={event.title} participantCount={0} isRecording={false} isModerator={isModerator} />
        <RecordingConsent onAccept={handleConsentAccept} onDecline={handleConsentDecline} />
      </>
    );
  }

  // ── Pre-join screen ──
  if (phase === 'pre_join') {
    return (
      <PreJoinScreen
        eventTitle={event.title}
        defaultName={chosenName || initialDisplayName}
        onJoin={handlePreJoin}
      />
    );
  }

  // ── Fetching JWT / Loading ──
  if (phase === 'fetching_jwt' || !credentials) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
        <Spinner active double />
        <p className="mt-3 text-muted">{t('connecting')}</p>
      </div>
    );
  }

  // ── Ready: Jitsi room ──
  const isActualModerator = credentials.role === 'moderator';

  return (
    <div className="d-flex flex-column live-page-bg" style={{ height: 'calc(100vh - 80px)' }}>
      <RecordingBanner visible={isRecording} />

      <LiveTopBar
        title={event.title}
        participantCount={participantCount}
        isRecording={isRecording}
        isModerator={isActualModerator}
        onLeaveRoom={handleLeaveRoom}
      />

      {isActualModerator && (
        <ModeratorControls
          api={jitsiApi}
          eventId={event.id}
          moderatorToken={token}
          recordingEnabled={event.recordingEnabled}
        />
      )}

      <div className="d-flex flex-column flex-lg-row flex-grow-1" style={{ minHeight: 0 }}>
        <div className="flex-grow-1 position-relative" style={{ minHeight: '300px' }}>
          <JitsiRoom
            domain={JITSI_DOMAIN}
            roomName={credentials.roomName}
            jwt={credentials.jwt}
            displayName={credentials.displayName}
            locale={locale}
            role={isActualModerator ? 'moderator' : 'participant'}
            participantsCanUnmute={event.participantsCanUnmute}
            participantsCanStartVideo={event.participantsCanStartVideo}
            participantsCanShareScreen={event.participantsCanShareScreen}
            onReady={handleJitsiReady}
            onLeft={handleJitsiLeft}
            onParticipantCountChanged={handleParticipantCountChanged}
            onRecordingStatusChanged={handleRecordingStatusChanged}
            onApiReady={handleApiReady}
          />
        </div>

        {event.qaEnabled && (
          <QAPanel
            eventSlug={event.slug}
            token={token}
            isModerator={isActualModerator}
          />
        )}
      </div>
    </div>
  );
}

// ── Top bar ──

interface LiveTopBarProps {
  title: string;
  participantCount: number;
  isRecording: boolean;
  isModerator: boolean;
  onLeaveRoom?: () => void;
}

function LiveTopBar({ title, participantCount, isRecording, isModerator, onLeaveRoom }: LiveTopBarProps) {
  const t = useTranslations('live');

  return (
    <div className="bg-primary text-white px-3 py-2 d-flex align-items-center justify-content-between live-top-bar">
      <div className="d-flex align-items-center">
        <h1 className="h6 mb-0 me-3 text-white">{title}</h1>
        {isModerator && (
          <Badge color="light" pill className="text-primary px-2 py-1 me-2">{t('moderatorBadge')}</Badge>
        )}
      </div>
      <div className="d-flex align-items-center gap-3">
        {isRecording && (
          <Badge color="danger" pill className="px-2 py-1">
            <span className="me-1">●</span>{t('recordingActive')}
          </Badge>
        )}
        <span className="small">
          <Icon icon="it-user" size="sm" color="white" className="me-1" />
          {t('moderator.participantCount', { count: participantCount })}
        </span>
        {onLeaveRoom && (
          <Button
            color="danger"
            outline
            size="xs"
            className="leave-room-btn"
            onClick={onLeaveRoom}
            aria-label={t('leaveRoom')}
          >
            <Icon icon="it-external-link" size="xs" color="white" className="me-1" />
            {t('leaveRoom')}
          </Button>
        )}
      </div>
    </div>
  );
}
