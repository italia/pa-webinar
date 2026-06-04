'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { createPortal } from 'react-dom';
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
import RaisedHandsPanel from '@/components/jitsi/raised-hands-panel';
import QAPanel from '@/components/qa/qa-panel';
import PollPanel from '@/components/polls/poll-panel';
import AgendaPanel from '@/components/live/agenda-panel';
import MaterialPanel from '@/components/materials/material-panel';
import ParticipantPanel from '@/components/participants/participant-panel';
import PreJoinScreen from '@/components/live/pre-join-screen';
import EventFeedback from '@/components/live/event-feedback';
import PresentationTimer from '@/components/live/presentation-timer';
import ReactionBar from '@/components/live/reaction-bar';
import ChatPanel from '@/components/live/chat-panel';
import WaitingRoom, { type WaitingRoomJoinPrefs } from '@/components/live/waiting-room';
import { splitTitleKicker } from '@/lib/utils/title-kicker';

interface EventInfo {
  id: string;
  slug: string;
  title: string;
  /** Resolved kicker flag (per-event override merged with site default). */
  parseTitleKicker?: boolean;
  startsAt: string;
  endsAt: string;
  status: string;
  eventType?: string;
  recordingEnabled: boolean;
  autoStartRecording?: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  agendaEnabled: boolean;
  waitingRoomAudioUrl: string | null;
  participantsCanUnmute: boolean;
  participantsCanStartVideo: boolean;
  participantsCanShareScreen: boolean;
  speakers?: string | null;
  organizerName?: string | null;
  moderatorName?: string | null;
  imageUrl?: string | null;
  coverImageUrl?: string | null;
  maxParticipants?: number;
  registrationCount?: number;
  /** Soft-exit grace in minutes past endsAt. Null → site default. */
  gracePeriodMinutes?: number | null;
  /** Resolved grace value (settings default applied). Used for the overtime banner. */
  effectiveGraceMinutes?: number;
  tempRecordingUrl?: string | null;
  recordingUrl?: string | null;
  feedbackEnabled?: boolean;
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
  /** Speaker ("relatore") magic-link grant. Full AV but no moderation. */
  isSpeaker?: boolean;
  isGuest?: boolean;
  displayName: string;
  locale: string;
  jitsiDomain: string;
  watermark?: WatermarkSettings;
  jibriAvailable?: boolean;
}

type LivePhase =
  | 'waiting'
  | 'consent_pending'
  | 'pre_join'
  | 'fetching_jwt'
  | 'ready'
  | 'reconnecting'
  | 'ended'
  | 'error';

// Maximum number of automatic rejoin attempts after a network-induced
// `videoConferenceLeft`. After this many failures we fall through to the
// "Evento concluso" screen so the user can decide what to do manually.
const MAX_RECONNECT_ATTEMPTS = 3;

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
  isSpeaker = false,
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

  // If the event was IDLE when this page rendered, the bridge has
  // been scaled to zero. Fire /wake once on mount so the scaler can
  // start the bridge in the background while the user reads the
  // waiting-room card and (if INSTANT) walks the garden. The poll
  // loop above picks up the LIVE transition and the "Entra ora" CTA
  // unblocks itself. /wake is idempotent and unauthenticated.
  const wokeOnceRef = useRef(false);
  useEffect(() => {
    if (wokeOnceRef.current) return;
    if (eventStatus !== 'IDLE') return;
    wokeOnceRef.current = true;
    void fetch(`/api/events/${event.slug}/wake`, { method: 'POST' }).catch(() => {
      // Transient: poll loop will retry the lifecycle check anyway.
    });
  }, [eventStatus, event.slug]);

  const [showFeedback, setShowFeedback] = useState(false);
  const [guestId] = useState(() => isGuest ? `guest_${Math.random().toString(36).slice(2, 10)}` : '');
  const [jvbReady, setJvbReady] = useState<boolean | null>(null);
  const [jibriReady, setJibriReady] = useState<boolean | null>(null);
  // Pre-join camera/mic choice captured by the waiting room's DeviceCheck.
  // Forwarded to JitsiRoom as `startWithVideoMuted`/`startWithAudioMuted`
  // so the user actually lands in the room with the state they picked.
  const [joinPrefs, setJoinPrefs] = useState<WaitingRoomJoinPrefs>({
    cameraOn: true,
    micOn: true,
  });

  // ── Network-resilience: distinguish intentional hangup (user clicked
  // "Esci dalla sala" or finished post-event flow) from an unintentional
  // `videoConferenceLeft` triggered by Jitsi when the participant's
  // network drops momentarily. Without this, the app immediately shows
  // "Evento concluso" on every blip and the user loses access to the
  // call. We retry up to MAX_RECONNECT_ATTEMPTS before giving up.
  const userHangupRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Determine initial phase. Everyone (guest, participant, moderator,
  // speaker) lands on the unified waiting room first regardless of
  // status (PUBLISHED / LIVE / ENDED) — the waiting room itself shows
  // the right content (countdown / join CTA / recording + feedback).
  // `phase='ended'` is now only reached mid-session when the Jitsi
  // connection ends, for the legacy "evento concluso" thank-you screen.
  // We also preserve `reconnecting` and `fetching_jwt` so a network blip
  // mid-event doesn't get clobbered back to the waiting room when the
  // LIVE→LIVE eventStatus poll re-fires this effect.
  useEffect(() => {
    setPhase((prev) =>
      prev === 'ready' ||
      prev === 'ended' ||
      prev === 'reconnecting' ||
      prev === 'fetching_jwt'
        ? prev
        : 'waiting',
    );
  }, [eventStatus]);

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

  // Fetch JWT. Shape of the request depends on the caller:
  //   - moderator / speaker magic-link:  moderatorToken=<token>
  //   - registered participant:          accessToken=<token>
  //   - anonymous guest (no token):      guestName=<name>
  const fetchJwt = useCallback(async () => {
    setError('');
    try {
      const body: Record<string, string> = {};
      if (isGuest || !token) {
        // Anonymous guest on a public (or password-cleared) LIVE event.
        // The typed name is required — we ensure it before transitioning
        // into fetching_jwt from the waiting room.
        body.guestName = chosenName.trim();
      } else if (isModerator || isSpeaker) {
        // Both moderators and speakers arrive via magic link → they use
        // the `moderatorToken` field (the JWT route's grant flow handles
        // the role distinction and issues the right Jitsi features).
        body.moderatorToken = token;
        if (chosenName && chosenName !== initialDisplayName) {
          body.displayNameOverride = chosenName;
        }
      } else {
        body.accessToken = token;
        if (chosenName && chosenName !== initialDisplayName) {
          body.displayNameOverride = chosenName;
        }
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
  }, [event.slug, isModerator, isSpeaker, isGuest, token, chosenName, initialDisplayName, t]);

  useEffect(() => {
    if (phase === 'fetching_jwt') { fetchJwt(); }
  }, [phase, fetchJwt]);

  const handleConsentAccept = useCallback(() => {
    // Name already collected in the waiting room; skip the (legacy)
    // pre-join name form and fetch the JWT directly. Keeping `pre_join`
    // as a reachable phase for the device-check experience Task 2 will
    // add — for now consent → JWT is the shortest path.
    setPhase('fetching_jwt');
  }, []);

  const handleConsentDecline = useCallback(() => {
    router.push(`/events/${event.slug}`);
  }, [router, event.slug]);

  const handlePreJoin = useCallback((name: string) => {
    setChosenName(name);
    setPhase('fetching_jwt');
  }, []);

  // Unified entry from the waiting room. Dispatches through the
  // consent → pre_join → fetching_jwt pipeline depending on role and
  // whether recording consent is required for this event.
  const handleEnterFromWaiting = useCallback((name: string, prefs: WaitingRoomJoinPrefs) => {
    setChosenName(name);
    setJoinPrefs(prefs);
    // Moderator + speaker magic-links skip the participant recording-
    // consent modal (they're the ones driving recording). Guests and
    // registered participants see it when recording is enabled.
    if (event.recordingEnabled && !isModerator && !isSpeaker) {
      setPhase('consent_pending');
    } else {
      // The waiting room has already collected the name + device
      // preferences, so jump straight to the JWT fetch.
      setPhase('fetching_jwt');
    }
  }, [event.recordingEnabled, isModerator, isSpeaker]);

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

  // While in the reconnecting phase, schedule an automatic re-init of
  // the JitsiRoom by flipping back to `fetching_jwt` (which already
  // re-runs the JWT exchange and re-mounts the iframe). Backoff is
  // 2s × current attempt number so we wait progressively longer between
  // tries (2s → 4s → 6s) without overloading a flaky link.
  useEffect(() => {
    if (phase !== 'reconnecting') return;
    const delay = 2000 * Math.max(1, reconnectAttemptsRef.current);
    reconnectTimerRef.current = setTimeout(() => {
      // Drop the stale credentials so the JWT route is re-hit (the JWT
      // may have aged out by the time the network is back). The
      // existing fetching_jwt → ready transition handles the rest.
      setCredentials(null);
      setPhase('fetching_jwt');
    }, delay);
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [phase]);

  const handleReconnectCancel = useCallback(() => {
    // The user explicitly gave up. Mark this as intentional so any
    // late-firing `videoConferenceLeft` doesn't loop us back here.
    userHangupRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setPhase('ended');
  }, []);

  const handleFeedbackClose = useCallback(() => {
    // Closing the post-event feedback panel is also a legitimate end of
    // the session — flag it so a late `videoConferenceLeft` doesn't try
    // to rejoin a call the user has already left for good.
    userHangupRef.current = true;
    setShowFeedback(false);
    setPhase('ended');
  }, []);

  const [showRecPrompt, setShowRecPrompt] = useState(false);
  const recPromptShownRef = useRef(false);
  const recPromptRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recPromptRetryRef.current) clearTimeout(recPromptRetryRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  // Shared "fire startRecording on Jitsi, with retry" — used both by the
  // moderator-confirmed prompt and by the autoStartRecording path which
  // bypasses the prompt entirely.
  const triggerRecording = useCallback((api: JitsiMeetExternalAPI) => {
    let attempts = 0;
    const tryStart = () => {
      try {
        api.executeCommand('startRecording', { mode: 'file' });
      } catch {
        if (attempts < 3) {
          attempts += 1;
          recPromptRetryRef.current = setTimeout(tryStart, 3000 * attempts);
        }
      }
    };
    tryStart();
  }, []);

  const autoOrPromptRecording = useCallback((api: JitsiMeetExternalAPI | null) => {
    if (event.autoStartRecording && api) {
      triggerRecording(api);
    } else {
      setShowRecPrompt(true);
    }
  }, [event.autoStartRecording, triggerRecording]);

  const handleJitsiReady = useCallback(() => {
    // Open a CallSession server-side so every live event has a row in
    // `call_sessions` with start/end timestamps even when no recording
    // is ever triggered. The route is idempotent — repeated calls (mod
    // + participants all firing onReady) converge on a single open row.
    void fetch(`/api/events/${event.slug}/sessions`, { method: 'POST' }).catch(() => {
      // Non-critical: absence of the session row just means the event
      // won't appear in monitoring/analytics histograms. Don't surface
      // to the user.
    });

    // Successful (re)entry: clear any pending reconnect bookkeeping so
    // the next genuine drop starts from a fresh attempt counter.
    reconnectAttemptsRef.current = 0;
    userHangupRef.current = false;

    if (isModerator && event.recordingEnabled && jibriReady && !recPromptShownRef.current) {
      recPromptShownRef.current = true;
      autoOrPromptRecording(jitsiApi);
    }
  }, [isModerator, event.recordingEnabled, event.slug, jibriReady, jitsiApi, autoOrPromptRecording]);

  // Show recording prompt (or auto-trigger) when Jibri becomes ready after
  // the room is already open.
  useEffect(() => {
    if (jibriReady && jitsiApi && isModerator && event.recordingEnabled && !recPromptShownRef.current) {
      recPromptShownRef.current = true;
      autoOrPromptRecording(jitsiApi);
    }
  }, [jibriReady, jitsiApi, isModerator, event.recordingEnabled, autoOrPromptRecording]);
  const handleJitsiLeft = useCallback(() => {
    // Intentional leave (user clicked "Esci dalla sala" / completed
    // the feedback flow): preserve the existing behavior — show the
    // post-event screen unless feedback is still visible.
    if (userHangupRef.current) {
      if (!showFeedback) setPhase('ended');
      return;
    }

    // Unintentional leave: Jitsi fired `videoConferenceLeft` but we
    // didn't ask for it. Could be a transient network drop, a JVB
    // restart, or the event genuinely ending. Ask the server which one
    // it is before deciding to show the "Evento concluso" screen.
    void (async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'ENDED') {
            setEventStatus('ENDED');
            setPhase('ended');
            return;
          }
        }
        // Anything else (LIVE, non-OK response we couldn't classify)
        // → assume the user dropped. Try to rejoin.
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setPhase('reconnecting');
        } else {
          setPhase('ended');
        }
      } catch {
        // Network error reaching our own API — most likely the user is
        // still offline. Treat as a transient drop and keep retrying
        // until we exhaust the attempt budget.
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setPhase('reconnecting');
        } else {
          setPhase('ended');
        }
      }
    })();
  }, [showFeedback, event.slug]);
  const handleParticipantCountChanged = useCallback((count: number) => { setParticipantCount(count); }, []);
  const handleRecordingStatusChanged = useCallback((recording: boolean) => { setIsRecording(recording); }, []);
  const handleApiReady = useCallback((api: JitsiMeetExternalAPI) => { setJitsiApi(api); }, []);

  const handleRecPromptStart = useCallback(() => {
    setShowRecPrompt(false);
    if (!jitsiApi) return;
    triggerRecording(jitsiApi);
  }, [jitsiApi, triggerRecording]);
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
    // Mark the upcoming `videoConferenceLeft` as a deliberate hangup so
    // the network-resilience path doesn't try to rejoin behind us.
    userHangupRef.current = true;
    if (jitsiApi) {
      jitsiApi.executeCommand('hangup');
    } else {
      setPhase('ended');
    }
  }, [jitsiApi]);

  const handleStartEvent = useCallback(async () => {
    const res = await fetch(`/api/events/${event.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'LIVE' }),
    });
    if (!res.ok) {
      throw new Error('Failed to start event');
    }
    setEventStatus('LIVE');
  }, [event.id, token]);

  // ── Waiting room (unified front door for every arrival) ──
  if (phase === 'waiting') {
    return (
      <WaitingRoom
        event={{
          title: event.title,
          slug: event.slug,
          parseTitleKicker: event.parseTitleKicker,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          status: eventStatus as 'PUBLISHED' | 'LIVE' | 'ENDED' | 'IDLE' | 'PROVISIONING',
          speakers: event.speakers,
          organizerName: event.organizerName,
          moderatorName: event.moderatorName,
          imageUrl: event.imageUrl,
          coverImageUrl: event.coverImageUrl,
          maxParticipants: event.maxParticipants ?? 300,
          recordingEnabled: event.recordingEnabled,
          tempRecordingUrl: event.tempRecordingUrl,
          recordingUrl: event.recordingUrl,
          waitingRoomAudioUrl: event.waitingRoomAudioUrl,
          feedbackEnabled: event.feedbackEnabled,
          chatEnabled: event.chatEnabled,
          qaEnabled: event.qaEnabled,
          timezone: event.timezone,
        }}
        participantCount={participantCount}
        role={isModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')}
        jvbReady={jvbReady}
        defaultName={chosenName || initialDisplayName}
        onEnterLive={handleEnterFromWaiting}
        onStartEvent={isModerator ? handleStartEvent : undefined}
        onLeaveFeedback={() => setShowFeedback(true)}
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
          <Link href={`/admin/events/${event.id}?token=${token}`}>
            <Button color="primary" outline tag="span">{tc('back')}</Button>
          </Link>
        ) : (
          <Link href={`/events/${event.slug}`}>
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
          <Link href={`/events/${event.slug}`}>
            <Button color="secondary" outline tag="span">{t('backToEvent')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Reconnecting (network drop recovery) ──
  if (phase === 'reconnecting') {
    return (
      <div
        className="d-flex flex-column align-items-center justify-content-center"
        style={{ minHeight: '60vh' }}
      >
        <div
          className="card p-4 text-center"
          style={{ maxWidth: 480, width: '100%' }}
          role="status"
          aria-live="polite"
        >
          <div className="d-flex justify-content-center mb-3">
            <Spinner active double />
          </div>
          <h2 className="h4 mb-3">{t('reconnecting')}</h2>
          <p className="mb-3 text-muted">{t('reconnectingMessage')}</p>
          <p className="small text-muted mb-4">
            {t('reconnectingAttempt', {
              n: reconnectAttemptsRef.current,
              total: MAX_RECONNECT_ATTEMPTS,
            })}
          </p>
          <div>
            <Button color="secondary" outline onClick={handleReconnectCancel}>
              {t('reconnectingCancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Recording consent ──
  if (phase === 'consent_pending') {
    return (
      <>
        <LiveTopBar title={event.title} parseTitleKicker={event.parseTitleKicker} imageUrl={event.imageUrl} coverImageUrl={event.coverImageUrl} participantCount={0} isRecording={false} role={isModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')} />
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
    <div className="d-flex flex-column live-page-bg">
      <RecordingBanner visible={isRecording} />
      <OvertimeBanner endsAt={event.endsAt} graceMinutes={event.effectiveGraceMinutes ?? 15} />

      <LiveTopBar
        title={event.title}
        parseTitleKicker={event.parseTitleKicker}
        imageUrl={event.imageUrl}
        coverImageUrl={event.coverImageUrl}
        participantCount={participantCount}
        registrationCount={event.registrationCount}
        maxParticipants={event.maxParticipants}
        isRecording={isRecording}
        role={isActualModerator ? 'moderator' : (isGuest ? 'guest' : 'participant')}
        onLeaveRoom={handleLeaveRoom}
      />

      <FirstEntryHintBanner />

      {isActualModerator && !showJvbOverlay && (
        <ModeratorControls
          api={jitsiApi}
          eventId={event.id}
          moderatorToken={token}
          recordingEnabled={event.recordingEnabled}
          jibriAvailable={jibriReady === true}
          participantsCanUnmute={event.participantsCanUnmute}
          participantsCanStartVideo={event.participantsCanStartVideo}
          localDisplayName={credentials?.displayName ?? chosenName ?? ''}
        />
      )}

      {!isInstantCall && !showJvbOverlay && (
        <PresentationTimer
          eventSlug={event.slug}
          token={token}
          isModerator={isActualModerator}
        />
      )}

      {/* Read-only raised-hands queue visible to ALL attendees so
          everyone sees who's in line to speak and in what order. The
          moderator still gets the full panel with "approve mic/video"
          buttons inside ModeratorControls above — this one stays
          compact and silent when no hand is up. */}
      {!isInstantCall && !showJvbOverlay && !isActualModerator && jitsiApi && (
        <RaisedHandsPanel
          api={jitsiApi}
          localDisplayName={credentials?.displayName ?? chosenName ?? ''}
          readOnly
        />
      )}

      {/* Screenshare banner — attention cue whenever someone in the
          room starts sharing. Jitsi auto-pins the share but a visible
          banner was requested because users missed the transition. */}
      {!isInstantCall && !showJvbOverlay && jitsiApi && (
        <ScreenshareBanner api={jitsiApi} />
      )}

      <div className="d-flex flex-column flex-lg-row flex-grow-1 live-body">
        <div className="d-flex flex-column flex-grow-1 live-main">
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
              eventSlug={event.slug}
              role={isActualModerator ? 'moderator' : 'participant'}
              participantsCanUnmute={event.participantsCanUnmute}
              participantsCanStartVideo={event.participantsCanStartVideo}
              participantsCanShareScreen={event.participantsCanShareScreen}
              enableFileSharing={isInstantCall}
              startWithVideoMuted={!joinPrefs.cameraOn}
              startWithAudioMuted={!joinPrefs.micOn}
              watermark={watermark}
              onReady={handleJitsiReady}
              onLeft={handleJitsiLeft}
              onParticipantCountChanged={handleParticipantCountChanged}
              onRecordingStatusChanged={handleRecordingStatusChanged}
              onApiReady={handleApiReady}
            />
            {!isInstantCall && <ReactionBar eventSlug={event.slug} />}
            {/* Floating controls slot: the sidebar portals its bar here
                so it sits on top of the Jitsi iframe (Meet-style) on
                both desktop and mobile. */}
            <div id="live-floating-controls-slot" className="live-floating-controls-slot" />
          </div>
        </div>

        <LiveSidebar
          eventSlug={event.slug}
          token={token}
          isModerator={isActualModerator}
          qaEnabled={event.qaEnabled}
          chatEnabled={event.chatEnabled}
          agendaEnabled={event.agendaEnabled}
          jitsiApi={jitsiApi}
          displayName={credentials.displayName}
          isInstantCall={isInstantCall}
        />
      </div>

      {showFeedback && (
        <EventFeedback
          eventSlug={event.slug}
          accessToken={!isGuest && !isModerator && !isSpeaker ? token : undefined}
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

type SidebarTab = 'qa' | 'chat' | 'polls' | 'agenda' | 'materials' | 'participants';

interface LiveSidebarProps {
  eventSlug: string;
  token: string;
  isModerator: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  agendaEnabled: boolean;
  jitsiApi: JitsiMeetExternalAPI | null;
  displayName: string;
  isInstantCall?: boolean;
}

function LiveSidebar({ eventSlug, token, isModerator, qaEnabled, chatEnabled, agendaEnabled, jitsiApi, displayName, isInstantCall = false }: LiveSidebarProps) {
  const t = useTranslations('live');
  // Live feature flags: i flag arrivano come props al mount, ma un moderatore
  // può attivarli/disattivarli DURANTE l'evento → li ripolliamo così i tab
  // reagiscono per tutti. I valori "eff*" sono quelli effettivi correnti.
  const { data: liveFlags, mutate: mutateFlags } = useSWR<{
    qaEnabled: boolean;
    chatEnabled: boolean;
    agendaEnabled: boolean;
    recordingEnabled: boolean;
  }>(
    isInstantCall ? null : `/api/events/${eventSlug}/flags`,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 15000 },
  );
  const effQa = liveFlags?.qaEnabled ?? qaEnabled;
  const effChat = liveFlags?.chatEnabled ?? chatEnabled;
  const effAgenda = liveFlags?.agendaEnabled ?? agendaEnabled;
  const showChat = effChat !== false;

  // Toggle di una funzione durante l'evento (moderatore): PUT del flag +
  // refresh ottimistico locale; gli altri client si allineano al prossimo
  // poll (15s).
  const toggleFeature = useCallback(
    async (key: 'qaEnabled' | 'chatEnabled' | 'agendaEnabled', current: boolean) => {
      await mutateFlags(
        (cur) => (cur ? { ...cur, [key]: !current } : cur),
        { revalidate: false },
      );
      await fetch(`/api/events/${eventSlug}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: !current }),
      });
      await mutateFlags();
    },
    [eventSlug, token, mutateFlags],
  );
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    isInstantCall ? 'participants' : (qaEnabled ? 'qa' : (showChat ? 'chat' : 'polls'))
  );
  const [participantCount, setParticipantCount] = useState(0);
  // Drawer-open state only matters on mobile (<992px); on desktop the
  // .live-sidebar is always visible via CSS regardless of this flag.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Chat unread count — set by ChatPanel via onUnreadCountChange.
  // A chat is "active" when the Chat tab is selected AND (on mobile)
  // the drawer is open.
  const [chatUnread, setChatUnread] = useState(0);
  const isChatActive = activeTab === 'chat';
  // Browser tab title flash: when unread increases while document is
  // hidden, prefix the title with "● ". Restore on focus. We scope
  // the effect to *this* sidebar instance so at most one listener is
  // registered at a time.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const BULLET = '● ';
    const originalTitle = document.title;
    let flashed = false;
    const setFlashed = (on: boolean) => {
      if (on === flashed) return;
      flashed = on;
      if (on) {
        if (!document.title.startsWith(BULLET)) {
          document.title = BULLET + document.title;
        }
      } else if (document.title.startsWith(BULLET)) {
        document.title = document.title.slice(BULLET.length);
      }
    };

    if (chatUnread > 0 && document.hidden) setFlashed(true);
    if (chatUnread === 0) setFlashed(false);

    const onVisibility = () => {
      if (!document.hidden) setFlashed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      setFlashed(false);
      // Best-effort restore in case a teardown happens mid-flash.
      if (document.title.startsWith(BULLET)) {
        document.title = originalTitle;
      }
    };
  }, [chatUnread]);

  // Meet-style floating controls live on top of the video; the drawer
  // slides in from the right on desktop / from the bottom on mobile.
  // The drawer is open when activeTab is set AND the user has clicked.
  // Rather than having two "open" flags we reuse `drawerOpen` as the
  // single source of truth and let the floating bar toggle it.
  const tabs: Array<{
    key: SidebarTab;
    label: string;
    svg: React.ReactNode;
    badge?: number;
    dot?: boolean;
    show: boolean;
  }> = [
    {
      key: 'qa',
      label: t('sidebarTabQa'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="10"/></svg>),
      show: !isInstantCall && effQa,
    },
    {
      key: 'chat',
      label: t('sidebarTabChat'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>),
      dot: chatUnread > 0,
      show: !isInstantCall && showChat,
    },
    {
      key: 'polls',
      label: t('sidebarTabPolls'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>),
      show: !isInstantCall,
    },
    {
      key: 'agenda',
      label: t('sidebarTabAgenda'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>),
      show: !isInstantCall && effAgenda,
    },
    {
      key: 'materials',
      label: t('sidebarTabMaterials'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>),
      show: !isInstantCall,
    },
    {
      key: 'participants',
      label: t('sidebarTabParticipants'),
      svg: (<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
      badge: participantCount,
      show: true,
    },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  const handleTabClick = useCallback((key: SidebarTab) => {
    // Toggle semantics: clicking the active-and-open tab closes the drawer.
    if (activeTab === key && drawerOpen) {
      setDrawerOpen(false);
      return;
    }
    setActiveTab(key);
    setDrawerOpen(true);
  }, [activeTab, drawerOpen]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // ESC closes the drawer (desktop users expect it, mobile scrim
  // already handles the tap-outside pattern).
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  // The floating controls portal target is mounted in LiveBody just
  // after <JitsiRoom>. We wait a tick after mount to read it, since
  // SSR returns null for document.getElementById.
  const [slot, setSlot] = useState<Element | null>(null);
  useEffect(() => {
    setSlot(document.getElementById('live-floating-controls-slot'));
  }, []);

  const floatingBar = (
    <div className="live-floating-controls" role="toolbar" aria-label={t('floatingControlsLabel')}>
      {visibleTabs.map((tab) => {
        const isActive = activeTab === tab.key && drawerOpen;
        return (
          <button
            key={tab.key}
            type="button"
            className={`live-floating-btn${isActive ? ' live-floating-btn--active' : ''}`}
            onClick={() => handleTabClick(tab.key)}
            aria-pressed={isActive}
          >
            <span className="live-floating-btn__icon">{tab.svg}</span>
            <span className="live-floating-btn__label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="live-floating-btn__badge" aria-hidden="true">{tab.badge}</span>
            )}
            {tab.dot && (
              <span
                className="live-floating-btn__dot"
                aria-label={t('sidebarTabChatUnread')}
                title={t('sidebarTabChatUnread')}
              />
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      {/* Floating control bar — portaled into the video wrapper so it
          overlays the Jitsi iframe and scales with the video. */}
      {slot && createPortal(floatingBar, slot)}

      {/* Scrim visible whenever the drawer is open (desktop + mobile).
          Click = close. */}
      <button
        type="button"
        className={`live-sidebar-scrim${drawerOpen ? ' live-sidebar-scrim--open' : ''}`}
        onClick={closeDrawer}
        aria-label={t('closeDrawer')}
        tabIndex={drawerOpen ? 0 : -1}
      />

      <div className={`d-flex flex-column live-sidebar${drawerOpen ? ' live-sidebar--open' : ''}`}>
        {/* Drawer header: active panel title + close button. */}
        <div className="live-sidebar-header d-flex align-items-center justify-content-between">
          <span className="fw-semibold" style={{ color: '#fff', fontSize: '0.95rem' }}>
            {visibleTabs.find((t) => t.key === activeTab)?.label}
          </span>
          <button
            type="button"
            className="btn btn-sm live-sidebar-close"
            onClick={closeDrawer}
            aria-label={t('closeDrawer')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex-grow-1 d-flex flex-column live-sidebar-body" style={{ minHeight: 0, overflowY: 'auto' }}>
          {/* Attivazione funzioni durante l'evento (solo moderatore). Le
              modifiche si propagano agli altri client via polling dei flag. */}
          {isModerator && !isInstantCall && (
            <div
              className="d-flex flex-wrap gap-2 px-3 py-2 align-items-center"
              style={{ borderBottom: '1px solid #e8e8e8', fontSize: '0.8rem' }}
            >
              <span className="text-secondary fw-semibold me-1">{t('liveFeaturesLabel')}</span>
              {([
                ['qaEnabled', t('sidebarTabQa'), effQa],
                ['chatEnabled', t('sidebarTabChat'), effChat],
                ['agendaEnabled', t('sidebarTabAgenda'), effAgenda],
              ] as const).map(([key, label, on]) => (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline-secondary'} py-0 px-2`}
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => void toggleFeature(key, on)}
                  aria-pressed={on}
                >
                  {on ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>
          )}
          {activeTab === 'qa' && effQa && (
            <QAPanel
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
              guestName={!token ? displayName : undefined}
            />
          )}
          {/* ChatPanel stays mounted while the event is live so it can
              keep its SSE open and count unreads while the user is on
              another tab. We hide it visually instead of unmounting. */}
          {showChat && (
            <div
              className="d-flex flex-column flex-grow-1"
              style={{
                minHeight: 0,
                display: activeTab === 'chat' ? undefined : 'none',
              }}
            >
              <ChatPanel
                eventSlug={eventSlug}
                token={token}
                displayName={displayName}
                isGuest={!token}
                active={isChatActive}
                onUnreadCountChange={setChatUnread}
              />
            </div>
          )}
          {activeTab === 'polls' && (
            <PollPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
          )}
          {activeTab === 'agenda' && effAgenda && (
            <AgendaPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
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
    </>
  );
}

// ── Top bar ──

type UserRole = 'moderator' | 'participant' | 'guest';

// Unified top bar (primary blue) with role-specific badge colors
const ROLE_BADGE_COLORS: Record<UserRole, { badge: string; badgeFg: string }> = {
  moderator: { badge: '#E8F0FE', badgeFg: 'var(--app-primary)' },
  participant: { badge: '#D4EDDA', badgeFg: '#155724' },
  guest: { badge: '#E9ECEF', badgeFg: 'var(--app-muted)' },
};

/**
 * Non-intrusive banner shown when the event has gone past its scheduled
 * endsAt but is within the grace window. Warns attendees the call will
 * close automatically; polls the wall clock every 30s so the countdown
 * is never more than half a minute stale.
 */
function OvertimeBanner({
  endsAt,
  graceMinutes,
}: {
  endsAt: string;
  graceMinutes: number;
}) {
  const t = useTranslations('live');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const endsAtMs = new Date(endsAt).getTime();
  if (now < endsAtMs) return null;

  // graceMinutes === -1 → never auto-close; graceMinutes === 0 → hard
  // close (banner wouldn't be visible anyway since the scaler flips
  // to ENDED instantly and the user gets redirected).
  if (graceMinutes === 0) return null;

  const closeAt = graceMinutes > 0
    ? new Date(endsAtMs + graceMinutes * 60_000)
    : null;
  const minutesLeft = closeAt
    ? Math.max(0, Math.ceil((closeAt.getTime() - now) / 60_000))
    : null;

  const message = closeAt && minutesLeft !== null
    ? minutesLeft > 0
      ? t('overtime.withCountdown', { minutes: minutesLeft })
      : t('overtime.closingNow')
    : t('overtime.indefinite');

  return (
    <div
      className="px-3 py-2 d-flex align-items-center gap-2 text-white small"
      style={{ background: '#A66300' }}
      role="status"
    >
      <span aria-hidden="true">⏱</span>
      {message}
    </div>
  );
}

interface LiveTopBarProps {
  title: string;
  /** When true, a `|` in the title renders the leading part as a small
   *  kicker line above the main title. Resolved server-side from the
   *  per-event override + site default. */
  parseTitleKicker?: boolean;
  /** Primary event cover (Prisma `event.imageUrl`). Preferred source for
   *  the small brand thumbnail rendered to the left of the title. */
  imageUrl?: string | null;
  /** Fallback cover (Prisma `event.coverImageUrl`). Used when `imageUrl`
   *  is unset — legacy events carry their hero image here. */
  coverImageUrl?: string | null;
  participantCount: number;
  /** Total confirmed registrations (if known). Shown alongside the live
   *  Jitsi count as "N attivi · M registrati". Omitted on public/guest
   *  views where we don't leak the registration total. */
  registrationCount?: number;
  /** Event capacity (maxParticipants). Used by the "live / capacity"
   *  pill in the top bar and as fallback when no one has joined yet. */
  maxParticipants?: number;
  isRecording: boolean;
  role: UserRole;
  onLeaveRoom?: () => void;
}

function LiveTopBar({ title, parseTitleKicker = false, imageUrl, coverImageUrl, participantCount, registrationCount, maxParticipants: _maxParticipants, isRecording, role, onLeaveRoom }: LiveTopBarProps) {
  const t = useTranslations('live');
  const tr = useTranslations('live.role');
  const badgeColors = ROLE_BADGE_COLORS[role];
  const { kicker, main } = splitTitleKicker(title, parseTitleKicker);
  const thumbUrl = imageUrl ?? coverImageUrl ?? null;
  const monogram = (main.trim().charAt(0) || title.trim().charAt(0) || '?').toUpperCase();

  return (
    <div
      className="text-white px-3 py-2 d-flex align-items-center justify-content-between live-top-bar"
      style={{
        background: 'linear-gradient(90deg, #004D99 0%, #0066CC 100%)',
        boxShadow: '0 2px 8px rgba(0, 40, 85, 0.3)',
      }}
    >
      <div className="d-flex align-items-center">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt=""
            aria-hidden="true"
            className="me-2 flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              objectFit: 'cover',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          />
        ) : (
          <span
            aria-hidden="true"
            className="me-2 flex-shrink-0 d-inline-flex align-items-center justify-content-center fw-bold"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'linear-gradient(135deg, #0066CC 0%, #004080 100%)',
              color: '#fff',
              fontSize: '0.8rem',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            {monogram}
          </span>
        )}
        <h1 className="h6 mb-0 me-3 text-white">
          {kicker && (
            <span
              className="event-title-kicker d-block"
              style={{ fontSize: '0.65rem', lineHeight: 1.1, opacity: 0.85 }}
            >
              {kicker}
            </span>
          )}
          <span className="event-title-main">{main}</span>
        </h1>
        <Badge
          color=""
          pill
          className="px-2 py-1 me-2"
          style={{ backgroundColor: badgeColors.badge, color: badgeColors.badgeFg, fontSize: '0.72rem' }}
        >
          {tr(role)}
        </Badge>
        {/* "👥 87" — capacity display is intentionally omitted: the system
         *  autoscales, so we only surface the live count. */}
        {participantCount > 0 && (
          <Badge
            color=""
            pill
            className="px-2 py-1"
            style={{
              backgroundColor: 'rgba(255,255,255,0.18)',
              color: '#fff',
              fontSize: '0.72rem',
            }}
            aria-live="polite"
          >
            {t('topBarCount.live', { count: participantCount })}
          </Badge>
        )}
      </div>
      <div className="d-flex align-items-center gap-3">
        {isRecording && (
          <Badge color="danger" pill className="px-2 py-1">
            <span className="me-1">●</span>{t('recordingActive')}
          </Badge>
        )}
        {registrationCount !== undefined && registrationCount > 0 && (
          <span className="small d-none d-md-inline">
            <Icon icon="it-user" size="sm" color="white" className="me-1" />
            {t('activeVsRegistered', { active: participantCount, registered: registrationCount })}
          </span>
        )}
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

// ── First-entry hint banner ──
//
// One-time dismissible tips shown the first time a user reaches phase=ready.
// Dismissal persists in localStorage so repeat joiners don't see it again.

const HINT_DISMISSED_KEY = 'pawebinar.liveHint.dismissed';

function FirstEntryHintBanner() {
  const t = useTranslations('live.hintBanner');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(HINT_DISMISSED_KEY) !== '1') {
        setVisible(true);
      }
    } catch {
      // Private mode / blocked storage → show the banner once per session.
      setVisible(true);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch { /* ignore */ }
  }, []);

  if (!visible) return null;

  return (
    <div
      className="px-3 py-2 d-flex flex-column flex-md-row align-items-md-center gap-2 gap-md-3 live-hint-banner"
      style={{
        background: '#E8F0FE',
        color: '#003D80',
        borderBottom: '1px solid #B6D4FE',
        fontSize: '0.85rem',
      }}
      role="note"
      aria-label="tips"
    >
      <span className="d-inline-flex align-items-center gap-2">
        <span aria-hidden="true">🎤</span>{t('controls')}
      </span>
      <span className="d-inline-flex align-items-center gap-2">
        <span aria-hidden="true">✋</span>{t('raiseHand')}
      </span>
      <span className="d-inline-flex align-items-center gap-2">
        <span aria-hidden="true">💬</span>{t('sidebar')}
      </span>
      <div className="ms-md-auto">
        <Button color="primary" size="xs" onClick={handleDismiss}>
          {t('dismiss')}
        </Button>
      </div>
    </div>
  );
}

// ── Screenshare banner ──
//
// Surfaces a slim highlighted strip at the top of the live area whenever
// any remote participant starts sharing their screen. Jitsi's own UI
// auto-pins the share and puts a small "is sharing" label on the tile,
// but attendees on the caffettino demo reported missing the transition
// ("la schermata non era evidenziata rispetto alle altre"). The banner
// uses Jitsi's `screenSharingStatusChanged` event — fires for every
// remote presenter with on/off, and also for the local user (which we
// filter out since the local presenter already knows).

function ScreenshareBanner({ api }: { api: JitsiMeetExternalAPI }) {
  const t = useTranslations('live');
  const [activeSharerId, setActiveSharerId] = useState<string | null>(null);
  const [activeSharerName, setActiveSharerName] = useState<string>('');
  const localIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onJoined = (evt: { id: string }) => {
      localIdRef.current = evt.id;
    };
    const onShareChanged = (evt: { id: string; on: boolean }) => {
      if (!evt.on) {
        if (activeSharerId === evt.id) {
          setActiveSharerId(null);
          setActiveSharerName('');
        }
        return;
      }
      if (evt.id === localIdRef.current) return; // don't ping the presenter
      setActiveSharerId(evt.id);
      const info = api.getParticipantsInfo().find((p) => p.id === evt.id);
      setActiveSharerName(info?.displayName ?? info?.formattedDisplayName ?? '');
    };
    const onLeft = (evt: { id: string }) => {
      if (activeSharerId === evt.id) {
        setActiveSharerId(null);
        setActiveSharerName('');
      }
    };

    api.addListener('videoConferenceJoined', onJoined);
    api.addListener('screenSharingStatusChanged', onShareChanged);
    api.addListener('participantLeft', onLeft);
    return () => {
      api.removeListener('videoConferenceJoined', onJoined);
      api.removeListener('screenSharingStatusChanged', onShareChanged);
      api.removeListener('participantLeft', onLeft);
    };
  }, [api, activeSharerId]);

  if (!activeSharerId) return null;

  return (
    <div
      className="d-flex align-items-center gap-2 px-3 py-2"
      style={{
        background: 'linear-gradient(90deg, #F7A11A 0%, #D97706 100%)',
        color: '#fff',
        fontSize: '0.88rem',
        fontWeight: 600,
        flexShrink: 0,
      }}
      role="status"
      aria-live="polite"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
        <line x1="8" y1="21" x2="16" y2="21"/>
        <line x1="12" y1="17" x2="12" y2="21"/>
      </svg>
      <span>{t('screenshareActive', { name: activeSharerName || t('screenshareFallbackName') })}</span>
    </div>
  );
}
