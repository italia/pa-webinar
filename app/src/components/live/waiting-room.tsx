'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  Icon,
  Spinner,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import AudioPlayer from '@/components/live/audio-player';
import VideoPlayer from '@/components/events/video-player';

interface WaitingRoomEvent {
  title: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  status: 'PUBLISHED' | 'LIVE';
  speakers?: string | null;
  organizerName?: string | null;
  maxParticipants: number;
  recordingEnabled: boolean;
  tempRecordingUrl?: string | null;
  waitingRoomAudioUrl?: string | null;
  timezone?: string;
}

interface WaitingRoomProps {
  event: WaitingRoomEvent;
  participantCount: number;
  role: 'moderator' | 'participant' | 'guest';
  jvbReady?: boolean | null;
  onEnterLive: () => void;
  onStartEvent?: () => void;
  onWatchRecording?: () => void;
}

const LATECOMER_THRESHOLD_MINUTES = 5;

type Scenario = 'not_started' | 'on_time' | 'late';

export default function WaitingRoom({
  event,
  participantCount,
  role,
  jvbReady,
  onEnterLive,
  onStartEvent,
}: WaitingRoomProps) {
  const t = useTranslations('waiting');
  const tc = useTranslations('common');
  const format = useFormatter();

  const [countdown, setCountdown] = useState('');
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [startingEvent, setStartingEvent] = useState(false);
  const [watchingCatchUp, setWatchingCatchUp] = useState(false);
  const [pulseCountdown, setPulseCountdown] = useState(false);

  const startsAtMs = new Date(event.startsAt).getTime();
  const isLive = event.status === 'LIVE';

  const scenario: Scenario = (() => {
    if (!isLive) return 'not_started';
    if (elapsedMinutes <= LATECOMER_THRESHOLD_MINUTES) return 'on_time';
    return 'late';
  })();

  useEffect(() => {
    function tick() {
      const now = Date.now();
      if (isLive) {
        const startedAt = event.tempRecordingUrl
          ? startsAtMs
          : startsAtMs;
        setElapsedMinutes(Math.floor((now - startedAt) / 60_000));
        return;
      }
      const diff = startsAtMs - now;
      if (diff <= 0) {
        setCountdown('');
        setPulseCountdown(false);
        return;
      }
      setPulseCountdown(diff < 60_000);
      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      const seconds = Math.floor((diff % 60_000) / 1000);
      const parts: string[] = [];
      if (days > 0) parts.push(`${days}g`);
      if (hours > 0) parts.push(`${String(hours).padStart(2, '0')}h`);
      parts.push(`${String(minutes).padStart(2, '0')}m`);
      parts.push(`${String(seconds).padStart(2, '0')}s`);
      setCountdown(parts.join('  '));
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isLive, startsAtMs, event.tempRecordingUrl]);

  const handleStartEvent = useCallback(async () => {
    if (!onStartEvent) return;
    setStartingEvent(true);
    onStartEvent();
  }, [onStartEvent]);

  if (watchingCatchUp && event.tempRecordingUrl) {
    return (
      <div className="container py-4">
        <div className="row justify-content-center">
          <div className="col-lg-10 col-xl-8">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h5 fw-semibold mb-0" style={{ color: '#17324D' }}>
                {event.title}
              </h2>
              <Button
                color="success"
                size="sm"
                className="fw-semibold"
                onClick={() => { setWatchingCatchUp(false); onEnterLive(); }}
              >
                <Icon icon="it-video" size="xs" color="white" className="me-1" />
                {t('enterLive')}
              </Button>
            </div>
            <VideoPlayer
              src={event.tempRecordingUrl}
              title={event.title}
            />
            <div className="mt-3 text-center">
              <Button
                color="primary"
                className="fw-semibold px-4"
                onClick={() => { setWatchingCatchUp(false); onEnterLive(); }}
              >
                {t('switchToLive')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-lg-7 col-xl-6">
          <Card className="shadow-sm border-0" style={{ borderRadius: 16 }}>
            <CardBody className="p-4 p-md-5 text-center">

              {/* ─── Scenario A: Not yet started ─── */}
              {scenario === 'not_started' && (
                <>
                  <div
                    className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                    style={{
                      width: 64,
                      height: 64,
                      background: 'linear-gradient(135deg, #0066CC, #004080)',
                    }}
                  >
                    <Icon icon="it-clock" size="lg" color="white" />
                  </div>

                  <h1 className="h4 fw-bold mb-2" style={{ color: '#17324D' }}>
                    {event.title}
                  </h1>

                  {(event.speakers || event.organizerName) && (
                    <p className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
                      {[event.speakers, event.organizerName].filter(Boolean).join(' · ')}
                    </p>
                  )}

                  {countdown && (
                    <div
                      className={`rounded-3 p-4 mb-4 mx-auto${pulseCountdown ? ' waiting-countdown--pulse' : ''}`}
                      style={{
                        background: 'linear-gradient(135deg, #0066CC, #004080)',
                        color: '#fff',
                        maxWidth: 340,
                      }}
                    >
                      <div className="small text-uppercase mb-1 opacity-75">
                        {t('startsIn')}
                      </div>
                      <div className="display-6 fw-bold font-monospace">
                        {countdown}
                      </div>
                    </div>
                  )}

                  <div className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
                    <Icon icon="it-calendar" size="xs" className="me-1" />
                    {format.dateTime(new Date(event.startsAt), {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      timeZone: event.timezone,
                    })}
                    {' · '}
                    {format.dateTime(new Date(event.startsAt), { hour: '2-digit', minute: '2-digit', timeZone: event.timezone })}
                    {' – '}
                    {format.dateTime(new Date(event.endsAt), { hour: '2-digit', minute: '2-digit', timeZone: event.timezone })}
                  </div>

                  {participantCount > 0 && (
                    <div className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
                      <Icon icon="it-user" size="xs" className="me-1" />
                      {t('peopleWaiting', { count: participantCount })}
                    </div>
                  )}

                  <div className="mb-4 d-flex justify-content-center">
                    <AudioPlayer audioUrl={event.waitingRoomAudioUrl} />
                  </div>

                  <Alert color="info" className="text-start mb-4" style={{ fontSize: '0.88rem' }}>
                    <Icon icon="it-info-circle" size="sm" className="me-2" />
                    {t('autoRefreshHint')}
                  </Alert>

                  {role === 'moderator' && onStartEvent && (
                    <div className="mb-3">
                      <Button
                        color="success"
                        size="lg"
                        className="px-5 fw-semibold"
                        onClick={handleStartEvent}
                        disabled={startingEvent}
                      >
                        {startingEvent ? (
                          <><Spinner active small className="me-2" />{t('startingEvent')}</>
                        ) : (
                          <><Icon icon="it-video" size="sm" color="white" className="me-2" />{t('startEventButton')}</>
                        )}
                      </Button>
                    </div>
                  )}

                  <Link href={`/eventi/${event.slug}`}>
                    <Button color="primary" outline tag="span" size="sm">
                      <Icon icon="it-arrow-left" size="xs" className="me-1" />
                      {tc('back')}
                    </Button>
                  </Link>
                </>
              )}

              {/* ─── Scenario B: On time ─── */}
              {scenario === 'on_time' && (
                <>
                  {jvbReady === false ? (
                    <div
                      className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                      style={{
                        width: 64,
                        height: 64,
                        background: 'linear-gradient(135deg, #FF9800, #F57C00)',
                      }}
                    >
                      <Spinner active small className="text-white" />
                    </div>
                  ) : (
                    <div
                      className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                      style={{
                        width: 64,
                        height: 64,
                        backgroundColor: '#D4EDDA',
                      }}
                    >
                      <Icon icon="it-check-circle" size="lg" className="text-success" />
                    </div>
                  )}

                  <Badge color="success" className="mb-3 px-3 py-2" style={{ fontSize: '0.85rem' }}>
                    {t('eventLive')}
                  </Badge>

                  <h1 className="h4 fw-bold mb-3" style={{ color: '#17324D' }}>
                    {event.title}
                  </h1>

                  {jvbReady === false && (
                    <Alert color="warning" className="text-start mb-4" style={{ fontSize: '0.88rem' }}>
                      <div className="d-flex align-items-start">
                        <Spinner active small className="me-2 mt-1 flex-shrink-0" />
                        <div>
                          <strong>{t('jvbScaling')}</strong>
                          <br />
                          {t('jvbScalingDetail')}
                        </div>
                      </div>
                    </Alert>
                  )}

                  <div className="d-flex justify-content-center gap-3 text-muted mb-4" style={{ fontSize: '0.9rem' }}>
                    <span>
                      <Icon icon="it-user" size="xs" className="me-1" />
                      {t('connectedParticipants', { count: participantCount })}
                    </span>
                    {elapsedMinutes > 0 && (
                      <span>
                        <Icon icon="it-clock" size="xs" className="me-1" />
                        {t('elapsedTime', { minutes: elapsedMinutes })}
                      </span>
                    )}
                  </div>

                  <Button
                    color="primary"
                    size="lg"
                    className="w-100 fw-semibold mb-4"
                    style={{ maxWidth: 360 }}
                    onClick={onEnterLive}
                  >
                    <Icon icon="it-video" size="sm" color="white" className="me-2" />
                    {t('enterRoom')}
                  </Button>

                  {event.recordingEnabled && (
                    <Alert color="warning" className="text-start" style={{ fontSize: '0.85rem' }}>
                      <Icon icon="it-camera" size="sm" className="me-2" />
                      {t('recordingNotice')}
                      {' '}
                      {t('recordingAvailableAfter')}
                    </Alert>
                  )}
                </>
              )}

              {/* ─── Scenario C: Late ─── */}
              {scenario === 'late' && (
                <>
                  <div
                    className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle"
                    style={{
                      width: 64,
                      height: 64,
                      backgroundColor: '#FFF3CD',
                    }}
                  >
                    <Icon icon="it-clock" size="lg" style={{ color: '#856404' }} />
                  </div>

                  <Badge
                    color=""
                    className="mb-3 px-3 py-2"
                    style={{ fontSize: '0.85rem', backgroundColor: '#FFF3CD', color: '#856404' }}
                  >
                    {t('youAreLate', { minutes: elapsedMinutes })}
                  </Badge>

                  <h1 className="h4 fw-bold mb-2" style={{ color: '#17324D' }}>
                    {event.title}
                  </h1>

                  {jvbReady === false && (
                    <Alert color="warning" className="text-start mb-4" style={{ fontSize: '0.88rem' }}>
                      <div className="d-flex align-items-start">
                        <Spinner active small className="me-2 mt-1 flex-shrink-0" />
                        <div>
                          <strong>{t('jvbScaling')}</strong>
                          <br />
                          {t('jvbScalingDetail')}
                        </div>
                      </div>
                    </Alert>
                  )}

                  <div className="text-muted mb-4" style={{ fontSize: '0.9rem' }}>
                    <Icon icon="it-user" size="xs" className="me-1" />
                    {t('connectedParticipants', { count: participantCount })}
                  </div>

                  <p className="fw-semibold mb-3" style={{ color: '#17324D' }}>
                    {t('chooseHowToJoin')}
                  </p>

                  <div className="row g-3 mb-4">
                    <div className={event.tempRecordingUrl ? 'col-12 col-md-6' : 'col-12'}>
                      <Card
                        className="h-100 border-0 shadow-sm"
                        style={{
                          borderRadius: 12,
                          borderLeft: '4px solid #0066CC',
                          cursor: 'pointer',
                        }}
                        onClick={onEnterLive}
                      >
                        <CardBody className="p-3 text-start">
                          <div className="fw-semibold mb-1" style={{ color: '#17324D' }}>
                            <span className="me-2">🎥</span>
                            {t('enterLive')}
                          </div>
                          <p className="text-muted mb-2" style={{ fontSize: '0.82rem' }}>
                            {t('enterLiveDesc')}
                          </p>
                          <Button color="primary" size="sm" className="fw-semibold" tag="span">
                            {t('enterNow')}
                          </Button>
                        </CardBody>
                      </Card>
                    </div>

                    {event.tempRecordingUrl && (
                      <div className="col-12 col-md-6">
                        <Card
                          className="h-100 border-0 shadow-sm"
                          style={{
                            borderRadius: 12,
                            borderLeft: '4px solid #008758',
                            cursor: 'pointer',
                          }}
                          onClick={() => setWatchingCatchUp(true)}
                        >
                          <CardBody className="p-3 text-start">
                            <div className="fw-semibold mb-1" style={{ color: '#17324D' }}>
                              <span className="me-2">⏪</span>
                              {t('watchFromStart')}
                            </div>
                            <p className="text-muted mb-2" style={{ fontSize: '0.82rem' }}>
                              {t('watchFromStartDesc')}
                            </p>
                            <Button color="success" size="sm" className="fw-semibold" tag="span">
                              {t('watchNow')}
                            </Button>
                          </CardBody>
                        </Card>
                      </div>
                    )}
                  </div>

                  {event.recordingEnabled && (
                    <Alert color="warning" className="text-start" style={{ fontSize: '0.85rem' }}>
                      <Icon icon="it-camera" size="sm" className="me-2" />
                      {t('recordingNotice')}
                    </Alert>
                  )}
                </>
              )}

            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
