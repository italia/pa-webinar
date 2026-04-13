'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Icon,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
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
import PollPanel from '@/components/polls/poll-panel';
import MaterialPanel from '@/components/materials/material-panel';
import ParticipantPanel from '@/components/participants/participant-panel';
import PreJoinScreen from '@/components/live/pre-join-screen';
import GuestJoinForm from '@/components/live/guest-join-form';
import EventFeedback from '@/components/live/event-feedback';
import PresentationTimer from '@/components/live/presentation-timer';
import ReactionBar from '@/components/live/reaction-bar';
import ChatPanel from '@/components/live/chat-panel';
import WaitingRoom from '@/components/live/waiting-room';

interface EventInfo {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: string;
  eventType?: string;
  recordingEnabled: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  waitingRoomAudioUrl: string | null;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  speakers?: string | null;
  organizerName?: string | null;
  maxParticipants?: number;
  tempRecordingUrl?: string | null;
  timezone?: string;
}

interface WatermarkSettings {
  url?: string;
  enabled?: boolean;
  opacity?: number;
  position?: string;
}

interface LiveEventClientProps {
  event: EventInfo;
  token: string;
  isModerator: boolean;
  isGuest?: boolean;
  displayName: string;
  locale: string;
  jitsiDomain: string;
  watermark?: WatermarkSettings;
  jibriAvailable?: boolean;
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

export default function LiveEventClient({
  event,
  token,
  isModerator,
  isGuest = false,
  displayName: initialDisplayName,
  locale,
  jitsiDomain,
  watermark,
  jibriAvailable: _jibriAvailable = true,
}: LiveEventClientProps) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const router = useRouter();

  const [phase, setPhase] = useState<LivePhase>('waiting');
  const [credentials, setCredentials] = useState<JitsiCredentials | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [jitsiApi, setJitsiApi] = useState<JitsiMeetExternalAPI | null>(null);
  const [chosenName, setChosenName] = useState(initialDisplayName);

  const [eventStatus, setEventStatus] = useState(event.status);
  const [showFeedback, setShowFeedback] = useState(false);
  const [guestId] = useState(() => isGuest ? `guest_${Math.random().toString(36).slice(2, 10)}` : '');
  const [jvbReady, setJvbReady] = useState<boolean | null>(null);
  const [jibriReady, setJibriReady] = useState<boolean | null>(null);

  // Poll infrastructure status (JVB + Jibri) when event is LIVE
  useEffect(() => {
    if (eventStatus !== 'LIVE') {
      setJvbReady(null);
      setJibriReady(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          setJvbReady(data.metrics?.jvbStatus === 'ready');
          setJibriReady(data.metrics?.jibriStatus === 'ready');
        }
      } catch { /* retry on next tick */ }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [eventStatus]);

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

  // Poll event status during ready phase to detect ENDED
  useEffect(() => {
    if (phase !== 'ready') return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'ENDED' && eventStatus !== 'ENDED') {
          setEventStatus('ENDED');
          if (!isModerator) {
            setShowFeedback(true);
          }
        }
      } catch { /* retry */ }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [phase, event.slug, eventStatus, isModerator]);

  const handleFeedbackClose = useCallback(() => {
    setShowFeedback(false);
    setPhase('ended');
  }, []);

  const [showRecPrompt, setShowRecPrompt] = useState(false);
  const recPromptShownRef = useRef(false);

  const handleJitsiReady = useCallback(() => {
    if (isModerator && event.recordingEnabled && jibriReady && !recPromptShownRef.current) {
      recPromptShownRef.current = true;
      setShowRecPrompt(true);
    }
  }, [isModerator, event.recordingEnabled, jibriReady]);

  // Show recording prompt when Jibri becomes ready after room is already open
  useEffect(() => {
    if (jibriReady && jitsiApi && isModerator && event.recordingEnabled && !recPromptShownRef.current) {
      recPromptShownRef.current = true;
      setShowRecPrompt(true);
    }
  }, [jibriReady, jitsiApi, isModerator, event.recordingEnabled]);
  const handleJitsiLeft = useCallback(() => {
    if (!showFeedback) setPhase('ended');
  }, [showFeedback]);
  const handleParticipantCountChanged = useCallback((count: number) => { setParticipantCount(count); }, []);
  const handleRecordingStatusChanged = useCallback((recording: boolean) => { setIsRecording(recording); }, []);
  const handleApiReady = useCallback((api: JitsiMeetExternalAPI) => { setJitsiApi(api); }, []);

  const handleRecPromptStart = useCallback(() => {
    if (jitsiApi) {
      try { jitsiApi.executeCommand('startRecording', { mode: 'file' }); } catch { /* handled by toast */ }
    }
    setShowRecPrompt(false);
  }, [jitsiApi]);
  const handleRecPromptLater = useCallback(() => { setShowRecPrompt(false); }, []);

  // Peak participant tracking (moderator only)
  useEffect(() => {
    if (!jitsiApi || !isModerator) return;
    const interval = setInterval(() => {
      const count = jitsiApi.getNumberOfParticipants?.();
      if (typeof count === 'number' && count > 0) {
        fetch(`/api/events/${event.slug}/analytics/peak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count, moderatorToken: token }),
        }).catch(() => {});
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [jitsiApi, isModerator, event.slug, token]);

  const handleLeaveRoom = useCallback(() => {
    if (jitsiApi) {
      jitsiApi.executeCommand('hangup');
    } else {
      setPhase('ended');
    }
  }, [jitsiApi]);

  // Moderator: start event
  const handleStartEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'LIVE' }),
      });
      if (!res.ok) return;
      setEventStatus('LIVE');
    } catch {
      // WaitingRoom handles its own loading state via onStartEvent callback
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
      <WaitingRoom
        event={{
          title: event.title,
          slug: event.slug,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          status: eventStatus as 'PUBLISHED' | 'LIVE',
          speakers: event.speakers,
          organizerName: event.organizerName,
          maxParticipants: event.maxParticipants ?? 300,
          recordingEnabled: event.recordingEnabled,
          tempRecordingUrl: event.tempRecordingUrl,
          waitingRoomAudioUrl: event.waitingRoomAudioUrl,
          timezone: event.timezone,
        }}
        participantCount={participantCount}
        role={isModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')}
        jvbReady={jvbReady}
        onEnterLive={() => {
          if (event.recordingEnabled && !isModerator) {
            setPhase('consent_pending');
          } else {
            setPhase('pre_join');
          }
        }}
        onStartEvent={isModerator ? handleStartEvent : undefined}
      />
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
        <LiveTopBar title={event.title} participantCount={0} isRecording={false} role={isModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')} />
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
  const isInstantCall = event.eventType === 'INSTANT';
  const showJvbOverlay = jvbReady !== true;

  return (
    <div className="d-flex flex-column live-page-bg" style={{ height: 'calc(100vh - 80px)' }}>
      <RecordingBanner visible={isRecording} />

      <LiveTopBar
        title={event.title}
        participantCount={participantCount}
        isRecording={isRecording}
        role={isActualModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')}
        onLeaveRoom={handleLeaveRoom}
      />

      {isActualModerator && !showJvbOverlay && (
        <ModeratorControls
          api={jitsiApi}
          eventId={event.id}
          moderatorToken={token}
          recordingEnabled={event.recordingEnabled}
          jibriAvailable={jibriReady === true}
          participantsCanUnmute={event.participantsCanUnmute}
          participantsCanStartVideo={event.participantsCanStartVideo}
        />
      )}

      {!isInstantCall && !showJvbOverlay && (
        <PresentationTimer
          eventSlug={event.slug}
          token={token}
          isModerator={isActualModerator}
        />
      )}

      <div className="d-flex flex-column flex-lg-row flex-grow-1" style={{ minHeight: 0 }}>
        <div className="d-flex flex-column flex-grow-1" style={{ minHeight: '300px' }}>
          <div className="flex-grow-1 position-relative">
            {showJvbOverlay && (
              <div
                className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center"
                style={{ zIndex: 10, background: 'rgba(15, 27, 45, 0.95)' }}
              >
                <Spinner active double className="mb-3" />
                <h2 className="h5 text-white fw-semibold mb-2">{t('roomPreparing')}</h2>
                <p className="text-white-50 mb-0" style={{ maxWidth: 400, textAlign: 'center' }}>
                  {t('roomPreparingDetail')}
                </p>
              </div>
            )}
            <JitsiRoom
              domain={jitsiDomain}
              roomName={credentials.roomName}
              jwt={credentials.jwt}
              displayName={credentials.displayName}
              locale={locale}
              role={isActualModerator ? 'moderator' : 'participant'}
              participantsCanUnmute={event.participantsCanUnmute}
              participantsCanStartVideo={event.participantsCanStartVideo}
              participantsCanShareScreen={event.participantsCanShareScreen}
              enableFileSharing={isInstantCall}
              watermark={watermark}
              onReady={handleJitsiReady}
              onLeft={handleJitsiLeft}
              onParticipantCountChanged={handleParticipantCountChanged}
              onRecordingStatusChanged={handleRecordingStatusChanged}
              onApiReady={handleApiReady}
            />
            {!isInstantCall && <ReactionBar eventSlug={event.slug} />}
          </div>
        </div>

        <LiveSidebar
          eventSlug={event.slug}
          token={token}
          isModerator={isActualModerator}
          qaEnabled={event.qaEnabled}
          chatEnabled={event.chatEnabled}
          jitsiApi={jitsiApi}
          displayName={credentials.displayName}
          isInstantCall={isInstantCall}
        />
      </div>

      {showFeedback && (
        <EventFeedback
          eventSlug={event.slug}
          accessToken={!isGuest && !isModerator ? token : undefined}
          guestId={isGuest ? guestId : undefined}
          onClose={handleFeedbackClose}
        />
      )}

      {/* Recording pre-activation prompt for moderator */}
      <Modal isOpen={showRecPrompt} toggle={handleRecPromptLater} centered>
        <ModalHeader toggle={handleRecPromptLater}>
          {t('recordingPromptTitle')}
        </ModalHeader>
        <ModalBody>
          <p>{t('recordingPromptBody')}</p>
        </ModalBody>
        <ModalFooter>
          <Button color="secondary" outline onClick={handleRecPromptLater}>
            {t('recordingPromptLater')}
          </Button>
          <Button color="primary" onClick={handleRecPromptStart}>
            {t('recordingPromptStart')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ── Sidebar with tabs ──

type SidebarTab = 'qa' | 'chat' | 'polls' | 'materials' | 'participants';

interface LiveSidebarProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  jitsiApi: JitsiMeetExternalAPI | null;
  displayName: string;
  isInstantCall?: boolean;
}

function LiveSidebar({ eventSlug, token, isModerator, qaEnabled, chatEnabled, jitsiApi, displayName, isInstantCall = false }: LiveSidebarProps) {
  const t = useTranslations('live');
  const showChat = chatEnabled !== false;
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    isInstantCall ? 'participants' : (qaEnabled ? 'qa' : (showChat ? 'chat' : 'polls'))
  );
  const [participantCount, setParticipantCount] = useState(0);

  const tabs: { key: SidebarTab; label: string; icon: string; badge?: number; show: boolean }[] = [
    { key: 'qa', label: t('sidebarTabQa'), icon: 'it-comment', show: !isInstantCall && qaEnabled },
    { key: 'chat', label: t('sidebarTabChat'), icon: 'it-mail', show: !isInstantCall && showChat },
    { key: 'polls', label: t('sidebarTabPolls'), icon: 'it-chart-line', show: !isInstantCall },
    { key: 'materials', label: t('sidebarTabMaterials'), icon: 'it-clip', show: !isInstantCall },
    { key: 'participants', label: t('sidebarTabParticipants'), icon: 'it-user', badge: participantCount, show: true },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  return (
    <div className="d-flex flex-column live-sidebar" style={{ width: '100%', maxWidth: '360px' }}>
      <div className="d-flex live-sidebar-header" style={{ overflowX: 'auto' }}>
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn btn-sm flex-fill d-flex align-items-center justify-content-center gap-1 live-sidebar-tab${
              activeTab === tab.key ? ' live-sidebar-tab--active' : ''
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Icon icon={tab.icon} size="xs" color="white" />
            <span className="d-none d-md-inline">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <Badge
                color=""
                pill
                style={{
                  fontSize: '0.6rem',
                  padding: '1px 5px',
                  backgroundColor: 'rgba(255,255,255,0.25)',
                  color: '#fff',
                }}
              >
                {tab.badge}
              </Badge>
            )}
          </button>
        ))}
      </div>

      <div className="flex-grow-1 d-flex flex-column" style={{ minHeight: 0, overflowY: 'auto' }}>
        {activeTab === 'qa' && qaEnabled && (
          <QAPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
        )}
        {activeTab === 'chat' && showChat && (
          <ChatPanel api={jitsiApi} displayName={displayName} />
        )}
        {activeTab === 'polls' && (
          <PollPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
        )}
        {activeTab === 'materials' && (
          <MaterialPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
        )}
        {activeTab === 'participants' && (
          <ParticipantPanel
            api={jitsiApi}
            isModerator={isModerator}
            onCountChange={setParticipantCount}
          />
        )}
      </div>
    </div>
  );
}

// ── Top bar ──

type UserRole = 'moderator' | 'participant' | 'guest';

// Unified top bar (primary blue) with role-specific badge colors
const ROLE_BADGE_COLORS: Record<UserRole, { badge: string; badgeFg: string }> = {
  moderator: { badge: '#E8F0FE', badgeFg: '#0066CC' },
  participant: { badge: '#D4EDDA', badgeFg: '#155724' },
  guest: { badge: '#E9ECEF', badgeFg: '#5A768A' },
};

interface LiveTopBarProps {
  title: string;
  participantCount: number;
  isRecording: boolean;
  role: UserRole;
  onLeaveRoom?: () => void;
}

function LiveTopBar({ title, participantCount, isRecording, role, onLeaveRoom }: LiveTopBarProps) {
  const t = useTranslations('live');
  const tr = useTranslations('live.role');
  const badgeColors = ROLE_BADGE_COLORS[role];

  return (
    <div
      className="text-white px-3 py-2 d-flex align-items-center justify-content-between live-top-bar"
      style={{
        background: 'linear-gradient(90deg, #004D99 0%, #0066CC 100%)',
        boxShadow: '0 2px 8px rgba(0, 40, 85, 0.3)',
      }}
    >
      <div className="d-flex align-items-center">
        <h1 className="h6 mb-0 me-3 text-white">{title}</h1>
        <Badge
          color=""
          pill
          className="px-2 py-1 me-2"
          style={{ backgroundColor: badgeColors.badge, color: badgeColors.badgeFg, fontSize: '0.72rem' }}
        >
          {tr(role)}
        </Badge>
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
