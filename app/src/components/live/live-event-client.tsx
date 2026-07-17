'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { createPortal, preconnect } from 'react-dom';
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
import type { VideoQualityPreset } from '@/lib/jitsi/config';
import { humanParticipantCount } from '@/lib/jitsi/participants';
import JitsiRoom from '@/components/jitsi/jitsi-room';
import RecordingConsent, { RecordingBanner } from '@/components/jitsi/recording-consent';
import ModeratorControls from '@/components/jitsi/moderator-controls';
import RaisedHandsPanel from '@/components/jitsi/raised-hands-panel';
import QAPanel from '@/components/qa/qa-panel';
import PollPanel from '@/components/polls/poll-panel';
import AgendaPanel from '@/components/live/agenda-panel';
import MaterialPanel from '@/components/materials/material-panel';
import ParticipantPanel from '@/components/participants/participant-panel';
import PreJoinScreen from '@/components/live/pre-join-screen';
import PostEventFeedbackModal from '@/components/live/post-event-feedback-modal';
import PresentationTimer from '@/components/live/presentation-timer';
import ReactionBar from '@/components/live/reaction-bar';
import ChatPanel from '@/components/live/chat-panel';
import WordCloud from '@/components/live/word-cloud';
import LiveShareButton from '@/components/live/live-share-button';
import WaitingRoom, {
  type WaitingRoomJoinPrefs,
  type WaitingRoomWarmup,
} from '@/components/live/waiting-room';
import { splitTitleKicker } from '@/lib/utils/title-kicker';
import { useSettings } from '@/lib/settings-context';

interface EventInfo {
  id: string;
  slug: string;
  title: string;
  /** Resolved kicker flag (per-event override merged with site default). */
  parseTitleKicker?: boolean;
  /** Resolved waiting-room engine (per-event override merged with site default). */
  waitingRoomEngine?: 'GARDEN' | 'GAME' | 'CLASSIC';
  /** Resolved video/audio quality preset (per-event override merged with site default). */
  videoQuality?: VideoQualityPreset;
  startsAt: string;
  endsAt: string;
  status: string;
  eventType?: string;
  recordingEnabled: boolean;
  autoStartRecording?: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  agendaEnabled: boolean;
  /** Per-event opt-in for the native Jitsi/Excalidraw whiteboard. */
  whiteboardEnabled: boolean;
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
  /** Admin-configured post-event visibility — used to seed the end-of-call
   *  "Destino evento" default so ending the call never silently overrides a
   *  pre-configured private (postEventPublic=false) or library setting. */
  postEventPublic?: boolean;
  libraryListed?: boolean;
  feedbackEnabled?: boolean;
  timezone?: string;
  /** True quando il master switch AI è attivo e l'evento usa almeno una
   *  feature di post-produzione AI — abilita l'informativa in sala d'attesa. */
  aiPostprodEnabled?: boolean;
  /** Testo custom per-locale dell'informativa AI (SiteSetting); null →
   *  la WaitingRoom usa il fallback i18n. */
  aiConsentDisclosure?: string | null;
  /** L'evento registra una traccia audio separata per partecipante →
   *  richiede consenso esplicito (hard-gate) prima di entrare. */
  multitrackRecordingEnabled?: boolean;
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
  /** True solo per il token primario dell'owner (non per i co-moderatori).
   *  Il pannello /admin accetta solo il token primario: i co-mod devono
   *  vedere "Torna all'evento", non il link admin che darebbe 404. */
  isPrimaryModerator?: boolean;
  /** Speaker ("relatore") magic-link grant. Full AV but no moderation. */
  isSpeaker?: boolean;
  isGuest?: boolean;
  /** Il partecipante registrato ha già prestato il consenso multitrack alla
   *  registrazione → non lo si richiede di nuovo in sala d'attesa. */
  hasMultitrackConsent?: boolean;
  displayName: string;
  locale: string;
  jitsiDomain: string;
  watermark?: WatermarkSettings;
  jibriAvailable?: boolean;
  /** Reactions mode (admin SiteSetting, #7): 'NATIVE' = Jitsi's own reactions
   *  button (ephemeral); 'CUSTOM' = the app's analytics-backed ReactionBar.
   *  Default 'NATIVE'. */
  reactionsMode?: 'NATIVE' | 'CUSTOM';
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

// Grace window after an UNFLAGGED `videoConferenceLeft` before we commit to
// reconnecting. Jitsi's native hangup fires videoConferenceLeft first and
// `readyToClose` a moment later; this window lets the intentional-close
// signal veto the reconnect so clicking hangup doesn't bounce the user back
// into the call. A genuine drop (no readyToClose) just reconnects 1.2s later.
const LEAVE_RECONNECT_GRACE_MS = 1200;

// The native Jitsi/Excalidraw whiteboard needs a collab backend deployed +
// Jitsi `config.whiteboard.enabled` server-side, which isn't provisioned yet.
// Keep BOTH the moderator button (moderator-controls.tsx) and the "export it
// before the call ends" hint hidden until that infra lands and this build-time
// env is set — same gate in both files so button and hint appear together.
const WHITEBOARD_INFRA_READY = process.env.NEXT_PUBLIC_WHITEBOARD_ENABLED === 'true';

// Phases that render the full-bleed call surface. While in one of these we
// flip the page into "immersive" mode (see `.live-call-immersive` in
// globals.scss): the call overlays the PA header/footer and the outer
// document scroll is locked, so the video sits in a single viewport-locked
// frame with no double scroll. The waiting room keeps the normal chrome.
const IMMERSIVE_PHASES = new Set<LivePhase>(['fetching_jwt', 'ready', 'reconnecting']);

// Statuses the waiting room knows how to render. The /lifecycle poll accepts
// a status transition only if it's one of these — DRAFT/ARCHIVED leak through
// that endpoint (it has no visibility filter) and would otherwise regress a
// terminal ENDED recap into the blank "opening at …" fallback.
const WAITING_ROOM_STATUSES = new Set([
  'PUBLISHED',
  'PROVISIONING',
  'IDLE',
  'LIVE',
  'ENDED',
]);

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
  isPrimaryModerator = false,
  isSpeaker = false,
  isGuest = false,
  hasMultitrackConsent = false,
  displayName: initialDisplayName,
  locale,
  jitsiDomain,
  watermark,
  jibriAvailable: _jibriAvailable = true,
  reactionsMode = 'NATIVE',
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
  // App-owned fullscreen (#6): fullscreen the whole live wrapper (video +
  // sidebar) instead of the Jitsi iframe, so the chat stays visible.
  const liveRootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chosenName, setChosenName] = useState(initialDisplayName);
  // True once THIS client is actually in the conference (Jitsi
  // `videoConferenceJoined` → handleJitsiReady). Used to lift the "warming up"
  // overlay as soon as we're in, instead of waiting on the coarse bridge-side
  // `jvbReady` flag — the opaque overlay otherwise sits over the native
  // mic/cam toolbar and swallows clicks during the ~2 min JVB warm-up.
  const [jitsiJoined, setJitsiJoined] = useState(false);

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

  // Warm the connection to the Jitsi origin while the user is still in the
  // waiting room, so external_api.js + the iframe + signaling aren't a cold
  // DNS/TLS/TCP handshake at join time (NEW-1 join-speed). Purely additive —
  // preconnect is a hint the browser can ignore, and it never fetches or
  // executes the script.
  useEffect(() => {
    if (!jitsiDomain) return;
    // No crossOrigin: external_api.js (a plain <script src>) and the iframe
    // navigation are NOT anonymous-CORS requests, so a same-origin-style
    // preconnect warms the socket they actually reuse.
    preconnect(`https://${jitsiDomain}`);
  }, [jitsiDomain]);

  const [showFeedback, setShowFeedback] = useState(false);
  // Stable anonymous id for guests, persisted in localStorage so a refresh or
  // a network-induced Jitsi reconnect keeps the same identity (poll/agenda
  // dedup + "my reaction" recall depend on it). SSR-safe: falls back to a
  // fresh in-memory id when window/localStorage is unavailable.
  const [guestId] = useState(() => {
    if (!isGuest) return '';
    const fresh = () => `guest_${Math.random().toString(36).slice(2, 10)}`;
    if (typeof window === 'undefined') return fresh();
    try {
      const k = 'paw_guest_id';
      let v = window.localStorage.getItem(k);
      if (!v) {
        v = fresh();
        window.localStorage.setItem(k, v);
      }
      return v;
    } catch {
      return fresh();
    }
  });
  const [jvbReady, setJvbReady] = useState<boolean | null>(null);
  const [jibriReady, setJibriReady] = useState<boolean | null>(null);
  // Telemetria warm-up dal poll /lifecycle (solo mentre IDLE/PROVISIONING):
  // alimenta il pannello di attesa onesto della WaitingRoom.
  const [warmup, setWarmup] = useState<WaitingRoomWarmup | null>(null);
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
  // Deferred reconnect decision after an unflagged leave (see handleJitsiLeft):
  // holds the grace timer so `readyToClose` can cancel it.
  const pendingLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      } catch {
        /* retry on next tick */
      }
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
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
        : 'waiting'
    );
  }, [eventStatus]);

  // Viewport-lock the call surface: hide the PA chrome behind the video and
  // kill the outer document scroll while the call (or its loading/reconnect
  // spinners) is on screen. The class is removed on unmount so navigating
  // away (or dropping to the waiting room / ended screen) restores scrolling.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('live-call-immersive', IMMERSIVE_PHASES.has(phase));
    return () => root.classList.remove('live-call-immersive');
  }, [phase]);

  // Poll event status in waiting room. Usa /lifecycle (più leggero della GET
  // evento completa) che durante il warm-up porta anche la telemetria JVB
  // (fase + provisioningStartedAt): è ciò che permette alla sala d'attesa di
  // mostrare una stima onesta invece dello spinner cieco.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}/lifecycle`);
        if (!res.ok) return;
        const data = await res.json();
        // /lifecycle has no visibility filter (unlike the public GET, which
        // 404s DRAFT/ARCHIVED). Ignore those transitions so an event archived
        // mid-view doesn't clobber the ENDED recap into the blank
        // "opening at …" branch — the waiting room only renders these states.
        if (
          data.status &&
          data.status !== eventStatus &&
          WAITING_ROOM_STATUSES.has(data.status)
        ) {
          setEventStatus(data.status);
        }
        setWarmup(
          data.jvb
            ? {
                phase: data.jvb.phase as 'queued' | 'starting' | 'ready',
                startedAt: data.jvb.startedAt ?? null,
                serverTime: data.serverTime,
              }
            : null
        );
      } catch {
        /* retry */
      }
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
        // The magic link is SHARED, so the generic grant name
        // ("Moderatore" / "Relatore") is never useful — always forward the
        // name the moderator typed in the waiting room (required there) so
        // each one shows up under their own identity in chat / the
        // participant list instead of all collapsing to "Moderatore".
        body.moderatorToken = token;
        if (chosenName.trim()) {
          body.displayNameOverride = chosenName.trim();
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
  }, [
    event.slug,
    isModerator,
    isSpeaker,
    isGuest,
    token,
    chosenName,
    initialDisplayName,
    t,
  ]);

  useEffect(() => {
    if (phase === 'fetching_jwt') {
      fetchJwt();
    }
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
  const handleEnterFromWaiting = useCallback(
    (name: string, prefs: WaitingRoomJoinPrefs) => {
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
    },
    [event.recordingEnabled, isModerator, isSpeaker]
  );

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
          // Drive the in-app "Evento concluso" closing screen instead of
          // leaving phase='ready' (which keeps repainting the JVB warming
          // overlay over a dead iframe — "Sala in preparazione"). Mark this
          // as an intentional end so a late `videoConferenceLeft` from the
          // tearing-down iframe doesn't bounce the user into 'reconnecting'.
          userHangupRef.current = true;
          setPhase('ended');
          if (!isModerator) {
            setShowFeedback(true);
          }
        }
      } catch {
        /* retry */
      }
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
      setJitsiJoined(false);
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

  // Moderator exit prompt: on leave, a host chooses "Esci solo tu" (leave,
  // call continues — the scaler demotes LIVE→IDLE after the inactivity grace)
  // vs "Termina per tutti" (flip status→ENDED now, everyone out immediately).
  const [showLeaveChoice, setShowLeaveChoice] = useState(false);
  const [endingForAll, setEndingForAll] = useState(false);
  const [endForAllError, setEndForAllError] = useState('');
  // "Destino evento" — chosen when the moderator ends the event for everyone.
  const [showEndDestino, setShowEndDestino] = useState(false);
  // Seed from the event's CONFIGURED post-event visibility so the modal's
  // pre-selected option preserves the admin's intent: confirming without
  // touching it must never flip a private event public, nor drop it from a
  // library it was set to appear in.
  const [endDestino, setEndDestino] = useState<'public' | 'library' | 'archive'>(
    event.libraryListed
      ? 'library'
      : event.postEventPublic === false
        ? 'archive'
        : 'public'
  );
  const [endGenAi, setEndGenAi] = useState(false);

  const [showRecPrompt, setShowRecPrompt] = useState(false);
  const recPromptShownRef = useRef(false);
  const recPromptRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recPromptRetryRef.current) clearTimeout(recPromptRetryRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pendingLeaveTimerRef.current) clearTimeout(pendingLeaveTimerRef.current);
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

  const autoOrPromptRecording = useCallback(
    (api: JitsiMeetExternalAPI | null) => {
      if (event.autoStartRecording && api) {
        triggerRecording(api);
      } else {
        setShowRecPrompt(true);
      }
    },
    [event.autoStartRecording, triggerRecording]
  );

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
    setJitsiJoined(true);

    if (
      isModerator &&
      event.recordingEnabled &&
      jibriReady &&
      !recPromptShownRef.current
    ) {
      recPromptShownRef.current = true;
      autoOrPromptRecording(jitsiApi);
    }
  }, [
    isModerator,
    event.recordingEnabled,
    event.slug,
    jibriReady,
    jitsiApi,
    autoOrPromptRecording,
  ]);

  // Show recording prompt (or auto-trigger) when Jibri becomes ready after
  // the room is already open.
  useEffect(() => {
    if (
      jibriReady &&
      jitsiApi &&
      isModerator &&
      event.recordingEnabled &&
      !recPromptShownRef.current
    ) {
      recPromptShownRef.current = true;
      autoOrPromptRecording(jitsiApi);
    }
  }, [jibriReady, jitsiApi, isModerator, event.recordingEnabled, autoOrPromptRecording]);
  // Authoritative "the user intentionally left" signal from Jitsi's
  // `readyToClose` (native hangup button, our executeCommand('hangup'),
  // moderator "Termina evento"). It fires ONLY on an intentional close,
  // never on a transient drop — so it cancels any pending or scheduled
  // reconnect and takes us straight to the closing screen. This is what
  // stops the native hangup from bouncing the user back into the call.
  // P1 analytics — record leave time (dwell/retention) for REGISTRANTS only.
  // Best-effort beacon: on intentional close (below) and on pagehide while
  // in-call (effect further down). Guests/moderators/speakers carry no
  // accessToken and are skipped. joinedAt was set at JWT-request time, so by
  // the time this can fire the user is genuinely a joined registrant.
  const sendLeaveBeacon = useCallback(() => {
    if (isGuest || isModerator || isSpeaker || !token) return;
    try {
      const url = `/api/events/${event.slug}/attendance/leave`;
      const payload = JSON.stringify({ accessToken: token });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } else {
        void fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => { /* analytics-only, best-effort */ });
      }
    } catch {
      /* best-effort */
    }
  }, [isGuest, isModerator, isSpeaker, token, event.slug]);

  const handleReadyToClose = useCallback(() => {
    sendLeaveBeacon();
    userHangupRef.current = true;
    if (pendingLeaveTimerRef.current) {
      clearTimeout(pendingLeaveTimerRef.current);
      pendingLeaveTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (!showFeedback) setPhase('ended');
  }, [showFeedback, sendLeaveBeacon]);

  // P1 analytics — beacon leave time on tab close / navigation away, but only
  // while actually in-call (phase 'ready'): before that there's no joinedAt to
  // pair with, and this avoids a stray leftAt from the waiting room.
  useEffect(() => {
    if (phase !== 'ready') return;
    const onHide = (e: PageTransitionEvent): void => {
      // persisted === true → the page is entering the bfcache (mobile
      // app-switch / back-forward cache) and may resume; only a real unload
      // (persisted === false) is a genuine leave. Avoids stamping leftAt while
      // the participant is still watching after switching apps.
      if (!e.persisted) sendLeaveBeacon();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [phase, sendLeaveBeacon]);

  const handleJitsiLeft = useCallback(() => {
    // Intentional leave already flagged (app "Esci dalla sala" button /
    // feedback flow / ENDED poll): show the post-event screen right away.
    if (userHangupRef.current) {
      if (!showFeedback) setPhase('ended');
      return;
    }

    // Unflagged `videoConferenceLeft`: EITHER the user clicked Jitsi's own
    // hangup ("termina chiamata" — a `readyToClose` follows within a moment)
    // OR the network genuinely dropped. Defer the reconnect decision by a
    // short grace window so `handleReadyToClose` can veto it; otherwise the
    // native hangup gets misread as a blip and rejoins immediately.
    if (pendingLeaveTimerRef.current) clearTimeout(pendingLeaveTimerRef.current);
    pendingLeaveTimerRef.current = setTimeout(() => {
      pendingLeaveTimerRef.current = null;
      // A readyToClose arrived during the grace window → intentional close.
      if (userHangupRef.current) {
        if (!showFeedback) setPhase('ended');
        return;
      }
      // No intentional-close signal — ask the server whether the event
      // ended (→ closing screen) or it's a real drop (→ reconnect).
      void (async () => {
        try {
          const res = await fetch(`/api/events/${event.slug}`);
          // readyToClose may still land while the fetch is in flight.
          if (userHangupRef.current) {
            setPhase('ended');
            return;
          }
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
          if (userHangupRef.current) {
            setPhase('ended');
            return;
          }
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            setPhase('reconnecting');
          } else {
            setPhase('ended');
          }
        }
      })();
    }, LEAVE_RECONNECT_GRACE_MS);
  }, [showFeedback, event.slug]);
  const handleParticipantCountChanged = useCallback((count: number) => {
    setParticipantCount(count);
  }, []);
  const handleRecordingStatusChanged = useCallback((recording: boolean) => {
    setIsRecording(recording);
  }, []);
  const handleApiReady = useCallback((api: JitsiMeetExternalAPI) => {
    setJitsiApi(api);
  }, []);

  const handleRecPromptStart = useCallback(() => {
    setShowRecPrompt(false);
    if (!jitsiApi) return;
    triggerRecording(jitsiApi);
  }, [jitsiApi, triggerRecording]);
  const handleRecPromptLater = useCallback(() => {
    setShowRecPrompt(false);
  }, []);

  // Peak participant tracking — reported by ANY authenticated attendee, not
  // just a moderator (live feedback #4b). Previously this was gated on
  // `isModerator`, so a moderator-less session (or one the moderator left before
  // the first tick) never bumped `peakParticipants`, leaving post-event
  // analytics at 0. We report the human-filtered count (Recorder excluded, same
  // helper as the sidebar). To avoid O(N) redundant writes on a big event, each
  // client only POSTs when its local count reaches a NEW local maximum (the
  // server value is monotonic and identical across clients anyway), so a steady
  // room goes quiet after the peak instead of every attendee POSTing every 30s.
  const lastReportedPeakRef = useRef(0);
  useEffect(() => {
    if (!jitsiApi || !token) return;
    const report = () => {
      const count = humanParticipantCount(jitsiApi, credentials?.displayName);
      if (count > 0 && count > lastReportedPeakRef.current) {
        lastReportedPeakRef.current = count;
        fetch(`/api/events/${event.slug}/analytics/peak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count, token }),
        }).catch(() => {});
      }
    };
    report();
    const interval = setInterval(report, 30000);
    return () => clearInterval(interval);
  }, [jitsiApi, event.slug, token, credentials]);

  // F8 — receive a moderator "lower your hand" control signal and lower our OWN
  // hand. The Jitsi IFrame API can lower only the local hand (toggleRaiseHand),
  // so a moderator's "abbassa mano" reaches the raiser's browser here; the
  // resulting raiseHandUpdated(0) then drains the queue on every client. Lives
  // here (not jitsi-room) because this component owns jitsiApi and stays mounted
  // for the whole live session; the control stream is separate from chat so it
  // works even when chat is disabled.
  const myEndpointIdRef = useRef('');
  // Jitsi's shared raise timestamp (evt.handRaised) for OUR hand; 0 = down. It
  // is the same value on every client for a given raise and changes on each new
  // raise, so it uniquely identifies WHICH raise a moderator asked us to lower.
  const myHandRaiseIdRef = useRef(0);
  // We only need to HEAR "lower your hand" while our hand is actually up, so the
  // control SSE is opened only then (effect below). This keeps the overwhelming
  // majority of participants — hand down — off the control channel entirely,
  // instead of every client holding an always-open stream for the whole session.
  const [handControlActive, setHandControlActive] = useState(false);
  useEffect(() => {
    if (!jitsiApi) return;

    const onJoined = (evt: { id?: string }) => {
      if (evt?.id) myEndpointIdRef.current = evt.id;
    };
    // Authoritative own-hand identity — sourced ONLY from Jitsi's broadcast for
    // OUR endpoint, never inferred. Also gates whether we hold the control SSE.
    const onHand = (evt: { id?: string; handRaised?: number }) => {
      if (!evt?.id || evt.id !== myEndpointIdRef.current) return;
      const raiseId = evt.handRaised ?? 0;
      myHandRaiseIdRef.current = raiseId;
      setHandControlActive(raiseId > 0);
    };
    jitsiApi.addListener('videoConferenceJoined', onJoined);
    jitsiApi.addListener('raiseHandUpdated', onHand);
    return () => {
      jitsiApi.removeListener('videoConferenceJoined', onJoined);
      jitsiApi.removeListener('raiseHandUpdated', onHand);
    };
  }, [jitsiApi]);

  // Hold the control SSE ONLY while our hand is raised. A moderator can only ask
  // to lower a hand that is up, and by the time they see it and click (seconds
  // later) this stream is long since open; when our hand goes down, onHand flips
  // handControlActive false and this effect tears the stream down.
  useEffect(() => {
    if (!jitsiApi || !handControlActive) return;

    const es = new EventSource(`/api/events/${event.slug}/control/stream`);
    const onControl = (e: MessageEvent) => {
      let env: { op?: string; targetEndpointId?: string; raiseId?: number };
      try {
        env = JSON.parse(e.data);
      } catch {
        return;
      }
      if (env.op !== 'lowerHand') return;
      // Exact endpoint match — a broadcast reaches everyone; a loose filter would
      // lower every hand.
      if (!env.targetEndpointId || env.targetEndpointId !== myEndpointIdRef.current) return;
      // Lower ONLY the exact raise the moderator targeted. toggleRaiseHand is a
      // toggle, so firing it when our hand is already down would RAISE it. Gating
      // on the shared raise id means a signal that raced a manual lower+re-raise
      // (our id differs now) is ignored — closing the re-raise race. Two rare,
      // benign residuals remain, inherent to a toggle-only API over a best-effort
      // channel: a moderator click landing in the sub-ms window between a manual
      // lower and its raiseHandUpdated(0) echo could re-raise once; and if the
      // toggle is delivered but silently not applied, the optimistic-0 below gates
      // further retries until the participant acts. Both self-recover.
      const raiseId = typeof env.raiseId === 'number' ? env.raiseId : 0;
      if (raiseId <= 0 || myHandRaiseIdRef.current !== raiseId) return;
      try {
        jitsiApi.executeCommand('toggleRaiseHand');
      } catch {
        return;
      }
      // Optimistically mark our hand down NOW. If the confirming
      // raiseHandUpdated(0) is dropped, a duplicate signal for the same raise
      // can't re-fire (0 !== raiseId) — closing the lost-confirmation re-raise.
      // A genuine re-raise later overwrites this via onHand.
      myHandRaiseIdRef.current = 0;
    };
    es.addEventListener('message', onControl);

    return () => {
      es.close();
    };
  }, [jitsiApi, event.slug, handControlActive]);

  // Leave for yourself only. Marks the upcoming `videoConferenceLeft` as a
  // deliberate hangup so the network-resilience path doesn't rejoin behind us.
  const leaveSelf = useCallback(() => {
    userHangupRef.current = true;
    if (jitsiApi) {
      jitsiApi.executeCommand('hangup');
    } else {
      setPhase('ended');
    }
  }, [jitsiApi]);

  // App-owned fullscreen toggle (#6): targets the live root wrapper so both the
  // Jitsi iframe AND the chat sidebar are in the fullscreen subtree. Optional
  // chaining makes it a safe no-op where Element.requestFullscreen is missing
  // (e.g. iPhone Safari).
  const toggleFullscreen = useCallback(() => {
    const root = liveRootRef.current;
    if (!root) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      root.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleLeaveRoom = useCallback(() => {
    // Moderators get the leave/end-for-all prompt; everyone else leaves for
    // themselves. (There is no native Jitsi hangup anymore — see config.ts —
    // so this app button is the single, consistent exit for every role.)
    if (isModerator) {
      setEndForAllError('');
      setShowLeaveChoice(true);
      return;
    }
    leaveSelf();
  }, [isModerator, leaveSelf]);

  const handleLeaveSelfChoice = useCallback(() => {
    setShowLeaveChoice(false);
    leaveSelf();
  }, [leaveSelf]);

  // "Termina per tutti": flip the event to ENDED (waiting participants and
  // those in the room detect it via their status poll and are taken to the
  // closing screen), then hang up our own client. Uses the moderator token.
  const handleEndForAll = useCallback(async () => {
    setEndingForAll(true);
    setEndForAllError('');
    try {
      // Single PUT that ends the event AND records the moderator's "destino":
      //  - archive → post-event page hidden (postEventPublic=false)
      //  - public  → post-event page visible
      //  - library → visible + listed in the public video library
      // + optional "genera AI": the recording hasn't uploaded yet, so we just
      //   set aiTranscriptEnabled — the Jibri finalize webhook auto-enqueues
      //   later, reading the now-true flag (no Recording exists to enqueue now).
      const body: Record<string, unknown> = {
        status: 'ENDED',
        postEventPublic: endDestino !== 'archive',
        ...(endDestino === 'library' && { libraryListed: true }),
        ...(endGenAi && { aiTranscriptEnabled: true, aiSummaryEnabled: true }),
      };
      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setEndingForAll(false);
        setEndForAllError(t('leaveChoice.endError'));
        return;
      }
      userHangupRef.current = true;
      setEventStatus('ENDED');
      setShowLeaveChoice(false);
      setShowEndDestino(false);
      setEndingForAll(false);
      if (jitsiApi) jitsiApi.executeCommand('hangup');
      setPhase('ended');
    } catch {
      setEndingForAll(false);
      setEndForAllError(t('leaveChoice.endError'));
    }
  }, [event.id, token, jitsiApi, t, endDestino, endGenAi]);

  const handleStartEvent = useCallback(async () => {
    const res = await fetch(`/api/events/${event.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'LIVE' }),
    });
    if (!res.ok) {
      throw new Error('Failed to start event');
    }
    setEventStatus('LIVE');
  }, [event.id, token]);

  // ── Waiting room (unified front door for every arrival) ──
  // Modal feedback post-evento: montato in TUTTI i branch da cui `showFeedback`
  // può diventare true (waiting → bottone "Lascia un feedback"; ended → poll che
  // rileva la fine; ready → chiusura in corso). Prima era montato solo nel return
  // di phase='ready', quindi il questionario non appariva mai a fine call e il
  // bottone in sala d'attesa era morto.
  const feedbackModal = showFeedback ? (
    <PostEventFeedbackModal
      eventSlug={event.slug}
      accessToken={!isGuest && !isModerator && !isSpeaker ? token : undefined}
      guestId={isGuest ? guestId : undefined}
      onClose={handleFeedbackClose}
    />
  ) : null;

  if (phase === 'waiting') {
    return (
      <>
        <WaitingRoom
          event={{
            title: event.title,
            slug: event.slug,
            parseTitleKicker: event.parseTitleKicker,
            waitingRoomEngine: event.waitingRoomEngine,
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            status: eventStatus as
              | 'PUBLISHED'
              | 'LIVE'
              | 'ENDED'
              | 'IDLE'
              | 'PROVISIONING',
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
            aiPostprodEnabled: event.aiPostprodEnabled,
            aiConsentDisclosure: event.aiConsentDisclosure,
            multitrackRecordingEnabled: event.multitrackRecordingEnabled,
          }}
          participantCount={participantCount}
          role={isModerator ? 'moderator' : isGuest ? 'guest' : 'participant'}
          jvbReady={jvbReady}
          warmup={warmup}
          // Uscita esplicita dalla sala d'attesa: le instant call non hanno una
          // pagina evento pubblica (404), quindi tornano alla home.
          exitHref={event.eventType === 'INSTANT' ? '/' : `/events/${event.slug}`}
          defaultName={chosenName || initialDisplayName}
          onEnterLive={handleEnterFromWaiting}
          onStartEvent={isModerator ? handleStartEvent : undefined}
          onLeaveFeedback={() => setShowFeedback(true)}
          // Esente dal consenso multitrack in sala d'attesa: chi l'ha già
          // prestato alla registrazione, o il moderatore (è chi ha configurato
          // e controlla la registrazione). Gli speaker NO: non controllano la
          // registrazione e la loro traccia audio isolata è esattamente il dato
          // (quasi-biometrico, ADR-013) che il gate protegge — devono spuntare
          // il consenso come ogni altro partecipante.
          multitrackConsentExempt={isModerator || hasMultitrackConsent}
        />
        {feedbackModal}
      </>
    );
  }

  // ── Ended ──
  if (phase === 'ended') {
    return (
      <div className="container py-5 text-center">
        <Icon icon="it-check-circle" size="xl" className="text-success mb-3" />
        <h1 className="h3 mb-3">{t('eventEnded')}</h1>
        <p className="mb-4">{t('eventEndedMessage')}</p>

        {/* Questionario post-evento: emerge a fine call (poll ENDED →
            setShowFeedback(true)) sopra questa schermata di chiusura. */}
        {feedbackModal}

        {isPrimaryModerator ? (
          <Link href={`/admin/events/${event.id}?token=${token}`}>
            <Button color="primary" outline tag="span">
              {tc('back')}
            </Button>
          </Link>
        ) : (
          // Co-moderatori, speaker e partecipanti: il pannello admin accetta
          // solo il token primario, quindi torniamo alla pagina evento.
          <Link href={`/events/${event.slug}`}>
            <Button color="primary" outline tag="span">
              {t('backToEvent')}
            </Button>
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
          <Button
            color="primary"
            onClick={() => setPhase('fetching_jwt')}
            className="me-3"
          >
            {tc('retry')}
          </Button>
          <Link href={`/events/${event.slug}`}>
            <Button color="secondary" outline tag="span">
              {t('backToEvent')}
            </Button>
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
        <LiveTopBar
          title={event.title}
          parseTitleKicker={event.parseTitleKicker}
          imageUrl={event.imageUrl}
          coverImageUrl={event.coverImageUrl}
          participantCount={0}
          isRecording={false}
          role={isModerator ? 'moderator' : isGuest ? 'guest' : 'participant'}
          slug={event.slug}
          locale={locale}
          moderatorToken={isModerator ? token : undefined}
        />
        <RecordingConsent
          onAccept={handleConsentAccept}
          onDecline={handleConsentDecline}
        />
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
      <div
        className="d-flex flex-column align-items-center justify-content-center"
        style={{ minHeight: '60vh' }}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Spinner active double />
        <p className="mt-3 text-muted">{t('connecting')}</p>
      </div>
    );
  }

  // ── Ready: Jitsi room ──
  const isActualModerator = credentials.role === 'moderator';
  const isInstantCall = event.eventType === 'INSTANT';
  // Only ever show the "warming up" overlay while the event is genuinely
  // LIVE and the bridge isn't ready yet. Once the event is ENDED we render
  // the closing screen (phase='ended'); guarding here is belt-and-braces so
  // the overlay can never repaint over a torn-down iframe if we're briefly
  // still on phase='ready'.
  // Keep the "warming up" curtain only until THIS client is actually in the
  // conference. Once joined, lift it even if the coarse bridge-side `jvbReady`
  // flag is still catching up — the opaque overlay otherwise sits over the
  // native mic/cam toolbar and swallows clicks during the JVB warm-up, so the
  // moderator can't set up their camera in the "allestimento" phase.
  const showJvbOverlay =
    eventStatus === 'LIVE' && jvbReady !== true && !jitsiJoined;

  return (
    <div ref={liveRootRef} className="d-flex flex-column live-page-bg">
      <RecordingBanner visible={isRecording} />
      <OvertimeBanner
        endsAt={event.endsAt}
        graceMinutes={event.effectiveGraceMinutes ?? 15}
      />

      <LiveTopBar
        title={event.title}
        parseTitleKicker={event.parseTitleKicker}
        imageUrl={event.imageUrl}
        coverImageUrl={event.coverImageUrl}
        participantCount={participantCount}
        registrationCount={event.registrationCount}
        maxParticipants={event.maxParticipants}
        isRecording={isRecording}
        role={isActualModerator ? 'moderator' : isGuest ? 'guest' : 'participant'}
        slug={event.slug}
        locale={locale}
        moderatorToken={isActualModerator ? token : undefined}
        onLeaveRoom={handleLeaveRoom}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
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
          whiteboardEnabled={event.whiteboardEnabled || isInstantCall}
          localDisplayName={credentials?.displayName ?? chosenName ?? ''}
          isPrimaryModerator={isPrimaryModerator}
        />
      )}

      {!showJvbOverlay && (
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
      {!showJvbOverlay && !isActualModerator && jitsiApi && (
        <RaisedHandsPanel
          api={jitsiApi}
          localDisplayName={credentials?.displayName ?? chosenName ?? ''}
          readOnly
        />
      )}

      {/* Screenshare banner — attention cue whenever someone in the
          room starts sharing. Jitsi auto-pins the share but a visible
          banner was requested because users missed the transition. */}
      {!showJvbOverlay && jitsiApi && <ScreenshareBanner api={jitsiApi} />}

      <div className="d-flex flex-column flex-lg-row flex-grow-1 live-body">
        <div className="d-flex flex-column flex-grow-1 live-main">
          <div className="flex-grow-1 position-relative">
            {showJvbOverlay && (
              <div
                className="position-absolute top-0 start-0 w-100 h-100 d-flex flex-column align-items-center justify-content-center"
                style={{ zIndex: 10, background: 'rgba(15, 27, 45, 0.95)' }}
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                <Spinner active double className="mb-3" />
                <h2 className="h5 text-white fw-semibold mb-2">{t('roomPreparing')}</h2>
                <p
                  className="text-white-50 mb-0"
                  style={{ maxWidth: 400, textAlign: 'center' }}
                >
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
              whiteboardEnabled={event.whiteboardEnabled || isInstantCall}
              videoQuality={event.videoQuality}
              reactionsMode={reactionsMode}
              startWithVideoMuted={!joinPrefs.cameraOn}
              startWithAudioMuted={!joinPrefs.micOn}
              watermark={watermark}
              onReady={handleJitsiReady}
              onLeft={handleJitsiLeft}
              onReadyToClose={handleReadyToClose}
              onParticipantCountChanged={handleParticipantCountChanged}
              onRecordingStatusChanged={handleRecordingStatusChanged}
              onApiReady={handleApiReady}
            />
            {/* Custom reactions bar only in CUSTOM mode (#7); NATIVE mode uses
                Jitsi's own reactions button in the toolbar instead. */}
            {reactionsMode === 'CUSTOM' && <ReactionBar eventSlug={event.slug} />}
            {/* Floating controls slot: the sidebar portals its bar here
                so it sits on top of the Jitsi iframe (Meet-style) on
                both desktop and mobile. */}
            <div
              id="live-floating-controls-slot"
              className="live-floating-controls-slot"
            />
          </div>
        </div>

        <LiveSidebar
          eventSlug={event.slug}
          eventId={event.id}
          token={token}
          isModerator={isActualModerator}
          qaEnabled={event.qaEnabled}
          chatEnabled={event.chatEnabled}
          agendaEnabled={event.agendaEnabled}
          whiteboardEnabled={event.whiteboardEnabled || isInstantCall}
          jitsiApi={jitsiApi}
          displayName={credentials.displayName}
          canReactAgenda={!isModerator && !isSpeaker}
          guestId={isGuest ? guestId : undefined}
        />
      </div>

      {feedbackModal}

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

      {/* Moderator leave prompt: leave for yourself vs end for everyone. */}
      <Modal
        isOpen={showLeaveChoice}
        toggle={() => !endingForAll && setShowLeaveChoice(false)}
        centered
      >
        <ModalHeader toggle={() => !endingForAll && setShowLeaveChoice(false)}>
          {t('leaveChoice.title')}
        </ModalHeader>
        <ModalBody>
          <p className="mb-0">{t('leaveChoice.body')}</p>
          {endForAllError && (
            <Alert color="danger" className="mt-3 mb-0" style={{ fontSize: '0.85rem' }}>
              {endForAllError}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={handleLeaveSelfChoice}
            disabled={endingForAll}
          >
            {t('leaveChoice.leaveSelf')}
          </Button>
          <Button
            color="danger"
            onClick={() => {
              setShowLeaveChoice(false);
              setEndForAllError('');
              setShowEndDestino(true);
            }}
            disabled={endingForAll}
          >
            {t('leaveChoice.endForAll')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* "Destino evento": what to do with the event once ended for everyone. */}
      <Modal
        isOpen={showEndDestino}
        toggle={() => !endingForAll && setShowEndDestino(false)}
        centered
      >
        <ModalHeader toggle={() => !endingForAll && setShowEndDestino(false)}>
          {t('endDestino.title')}
        </ModalHeader>
        <ModalBody>
          <p className="mb-3" style={{ fontSize: '0.9rem' }}>
            {t('endDestino.body')}
          </p>
          <div className="d-flex flex-column gap-2">
            {(['public', 'library', 'archive'] as const).map((opt) => (
              <label
                key={opt}
                className="d-flex align-items-start gap-2 p-2 rounded"
                style={{
                  cursor: 'pointer',
                  border: `1px solid ${endDestino === opt ? '#0066cc' : '#e0e0e0'}`,
                  background: endDestino === opt ? '#f0f7ff' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="endDestino"
                  className="mt-1"
                  checked={endDestino === opt}
                  onChange={() => setEndDestino(opt)}
                  disabled={endingForAll}
                />
                <span>
                  <span className="fw-semibold d-block">{t(`endDestino.${opt}`)}</span>
                  <small className="text-muted">{t(`endDestino.${opt}Help`)}</small>
                </span>
              </label>
            ))}
          </div>
          {event.recordingEnabled && event.aiPostprodEnabled && (
            <label
              className="d-flex align-items-center gap-2 mt-3"
              style={{ cursor: 'pointer', fontSize: '0.88rem' }}
            >
              <input
                type="checkbox"
                checked={endGenAi}
                onChange={(e) => setEndGenAi(e.target.checked)}
                disabled={endingForAll}
              />
              <span>{t('endDestino.genAi')}</span>
            </label>
          )}
          {endForAllError && (
            <Alert color="danger" className="mt-3 mb-0" style={{ fontSize: '0.85rem' }}>
              {endForAllError}
            </Alert>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            color="secondary"
            outline
            onClick={() => {
              setShowEndDestino(false);
              setShowLeaveChoice(true);
            }}
            disabled={endingForAll}
          >
            {t('endDestino.back')}
          </Button>
          <Button color="danger" onClick={handleEndForAll} disabled={endingForAll}>
            {endingForAll ? (
              <>
                <Spinner active small className="me-2" />
                {t('leaveChoice.ending')}
              </>
            ) : (
              t('endDestino.confirm')
            )}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ── Sidebar with tabs ──

type SidebarTab =
  | 'qa'
  | 'chat'
  | 'polls'
  | 'wordcloud'
  | 'agenda'
  | 'materials'
  | 'participants';

interface LiveSidebarProps {
  eventSlug: string;
  /** Event UUID — used for the moderator feature-toggle PUT. The
   *  /api/events/[param] route accepts updates ONLY by UUID (a slug 400s
   *  before touching the DB). The slug is still used for the GET /flags poll,
   *  which resolves by slug. */
  eventId: string;
  token: string;
  isModerator: boolean;
  qaEnabled: boolean;
  chatEnabled: boolean;
  agendaEnabled: boolean;
  /** Whiteboard is enabled for this call → show the "not saved" reminder. */
  whiteboardEnabled: boolean;
  jitsiApi: JitsiMeetExternalAPI | null;
  displayName: string;
  /** Audience (guests + registered participants) may react to agenda items;
   *  presenters (moderators/speakers) only see the tallies. */
  canReactAgenda?: boolean;
  /** Stable guest id (anonymous) for agenda-reaction dedup; undefined for
   *  registered participants (identified by their accessToken). */
  guestId?: string;
}

function LiveSidebar({
  eventSlug,
  eventId,
  token,
  isModerator,
  qaEnabled,
  chatEnabled,
  agendaEnabled,
  whiteboardEnabled,
  jitsiApi,
  displayName,
  canReactAgenda = false,
  guestId,
}: LiveSidebarProps) {
  const t = useTranslations('live');
  // Live feature flags: i flag arrivano come props al mount, ma un moderatore
  // può attivarli/disattivarli DURANTE l'evento → li ripolliamo così i tab
  // reagiscono per tutti. I valori "eff*" sono quelli effettivi correnti.
  const { data: liveFlags, mutate: mutateFlags } = useSWR<{
    qaEnabled: boolean;
    chatEnabled: boolean;
    agendaEnabled: boolean;
    wordCloudEnabled: boolean;
    recordingEnabled: boolean;
  }>(
    `/api/events/${eventSlug}/flags`,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 15000 }
  );
  const effQa = liveFlags?.qaEnabled ?? qaEnabled;
  const effChat = liveFlags?.chatEnabled ?? chatEnabled;
  const effAgenda = liveFlags?.agendaEnabled ?? agendaEnabled;
  // Word cloud is opt-in and OFF by default: the tab stays hidden until the
  // flags poll reports it enabled (no per-event prop → safe default false, so
  // it never flashes on before the real value loads).
  const effWordCloud = liveFlags?.wordCloudEnabled ?? false;
  const showChat = effChat !== false;

  // Toggle di una funzione durante l'evento (moderatore): PUT del flag +
  // refresh ottimistico locale; gli altri client si allineano al prossimo
  // poll (15s).
  const toggleFeature = useCallback(
    async (
      key: 'qaEnabled' | 'chatEnabled' | 'agendaEnabled' | 'wordCloudEnabled',
      current: boolean,
    ) => {
      await mutateFlags((cur) => (cur ? { ...cur, [key]: !current } : cur), {
        revalidate: false,
      });
      // PUT by UUID: the /api/events/[param] route rejects a non-UUID param
      // with 400 before touching the DB, so using the slug here made every
      // toggle a SILENT no-op (button flipped, then the poll reverted it).
      const res = await fetch(`/api/events/${eventId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [key]: !current }),
      });
      // Re-sync from the server. On success it confirms the flip; on failure
      // the server still holds the old value, so this rolls the optimistic
      // flip back instead of leaving the button stuck in the wrong state.
      await mutateFlags();
      if (!res.ok) {
        console.error('toggleFeature failed', key, res.status);
      }
    },
    [eventId, token, mutateFlags]
  );
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    // Chat is the primary channel (live feedback #10): prefer it as the initial
    // tab, falling back to Q&A then polls only when chat is disabled.
    showChat ? 'chat' : qaEnabled ? 'qa' : 'polls'
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
    // Chat first (live feedback #10): it is the primary audience channel, so it
    // renders as the leftmost sidebar tab, ahead of Q&A.
    {
      key: 'chat',
      label: t('sidebarTabChat'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
      dot: chatUnread > 0,
      show: showChat,
    },
    {
      key: 'qa',
      label: t('sidebarTabQa'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
          <circle cx="12" cy="12" r="10" />
        </svg>
      ),
      show: effQa,
    },
    {
      key: 'polls',
      label: t('sidebarTabPolls'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 4 5-5" />
        </svg>
      ),
      show: true,
    },
    {
      key: 'wordcloud',
      label: t('sidebarTabWordcloud'),
      // Inline SVG (not design-react-kit <Icon>) per the project hydration
      // rule for components rendered in the live chrome.
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 7h10" />
          <path d="M4 12h16" />
          <path d="M4 17h7" />
        </svg>
      ),
      show: effWordCloud,
    },
    {
      key: 'agenda',
      label: t('sidebarTabAgenda'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
      show: effAgenda,
    },
    {
      key: 'materials',
      label: t('sidebarTabMaterials'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      ),
      show: true,
    },
    {
      key: 'participants',
      label: t('sidebarTabParticipants'),
      svg: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      badge: participantCount,
      show: true,
    },
  ];

  const visibleTabs = tabs.filter((tab) => tab.show);

  // If the moderator turns off the active tab's feature mid-event (e.g.
  // disables Q&A), that tab drops out of visibleTabs — without this the drawer
  // header/body would render blank. Fall back to the first still-visible tab.
  const visibleTabKeys = visibleTabs.map((tab) => tab.key);
  const firstVisibleKey = visibleTabKeys[0];
  const activeTabIsVisible = visibleTabKeys.includes(activeTab);
  useEffect(() => {
    if (firstVisibleKey && !activeTabIsVisible) setActiveTab(firstVisibleKey);
  }, [firstVisibleKey, activeTabIsVisible]);

  const handleTabClick = useCallback(
    (key: SidebarTab) => {
      // Toggle semantics: clicking the active-and-open tab closes the drawer.
      if (activeTab === key && drawerOpen) {
        setDrawerOpen(false);
        return;
      }
      setActiveTab(key);
      setDrawerOpen(true);
    },
    [activeTab, drawerOpen]
  );

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
    <div
      className="live-floating-controls"
      role="toolbar"
      aria-label={t('floatingControlsLabel')}
    >
      {visibleTabs.map((tab) => {
        // Highlight the active tab regardless of drawerOpen: on desktop the
        // column is always visible; on mobile the strip should still show
        // which panel is selected even when the drawer is collapsed.
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            className={`live-floating-btn${isActive && drawerOpen ? ' live-floating-btn--active' : ''}`}
            onClick={() => handleTabClick(tab.key)}
            aria-pressed={isActive}
          >
            <span className="live-floating-btn__icon">{tab.svg}</span>
            <span className="live-floating-btn__label">{tab.label}</span>
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className="live-floating-btn__badge" aria-hidden="true">
                {tab.badge}
              </span>
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

      <div
        className={`d-flex flex-column live-sidebar${drawerOpen ? ' live-sidebar--open' : ''}`}
      >
        {/* Desktop persistent-column tab strip (mobile keeps the floating bar
            + drawer header below). Proper tablist semantics for keyboard/SR. */}
        <div
          className="live-sidebar-tabs"
          role="tablist"
          aria-label={t('floatingControlsLabel')}
        >
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tab.label}
                className={`live-sidebar-tab${isActive ? ' live-sidebar-tab--active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <span className="live-floating-btn__icon" aria-hidden="true">
                  {tab.svg}
                </span>
                <span className="live-sidebar-tab__label">{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="live-sidebar-tab__badge">{tab.badge}</span>
                )}
                {tab.dot && <span className="live-sidebar-tab__dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {/* Drawer header (mobile only): active panel title + close button.
            On desktop the tab strip above replaces it. */}
        <div className="live-sidebar-header d-flex d-lg-none align-items-center justify-content-between">
          <span className="fw-semibold" style={{ color: '#fff', fontSize: '0.95rem' }}>
            {visibleTabs.find((t) => t.key === activeTab)?.label}
          </span>
          <button
            type="button"
            className="btn btn-sm live-sidebar-close"
            onClick={closeDrawer}
            aria-label={t('closeDrawer')}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div
          className="flex-grow-1 d-flex flex-column live-sidebar-body"
          style={{ minHeight: 0, overflowY: 'auto' }}
        >
          {/* Attivazione funzioni durante l'evento (solo moderatore). Le
              modifiche si propagano agli altri client via polling dei flag. */}
          {isModerator && (
            <div
              className="d-flex flex-wrap gap-2 px-3 py-2 align-items-center"
              style={{ borderBottom: '1px solid #e8e8e8', fontSize: '0.8rem' }}
            >
              <span className="text-secondary fw-semibold me-1">
                {t('liveFeaturesLabel')}
              </span>
              {(
                [
                  ['qaEnabled', t('sidebarTabQa'), effQa],
                  ['chatEnabled', t('sidebarTabChat'), effChat],
                  ['agendaEnabled', t('liveToggleAgenda'), effAgenda],
                  ['wordCloudEnabled', t('sidebarTabWordcloud'), effWordCloud],
                ] as const
              ).map(([key, label, on]) => (
                <button
                  key={key}
                  type="button"
                  className={`btn btn-sm ${on ? 'btn-primary' : 'btn-outline-secondary'} py-0 px-2`}
                  style={{ fontSize: '0.78rem' }}
                  onClick={() => void toggleFeature(key, on)}
                  aria-pressed={on}
                >
                  {on ? '✓ ' : ''}
                  {label}
                </button>
              ))}
            </div>
          )}
          {/* Whiteboard isn't persisted (native Jitsi/Excalidraw is ephemeral and
              end-to-end encrypted — there's no capture hook). Remind moderators
              to export + attach it as a material before the call ends. */}
          {isModerator && whiteboardEnabled && WHITEBOARD_INFRA_READY && (
            <div
              className="px-3 py-2"
              style={{ borderBottom: '1px solid #e8e8e8', fontSize: '0.78rem' }}
              role="note"
            >
              <span className="text-secondary">💡 {t('whiteboardNotSavedHint')}</span>
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
            // Kept MOUNTED (SSE open + unread counting on other tabs) but
            // toggled via d-flex/d-none, not an inline `display`: Bootstrap
            // Italia's `.d-flex { display:flex !important }` beats a plain
            // inline `display:none`, so the old inline hide was ignored and
            // the chat stayed stacked under the active tab (sidebar "spaccata").
            // Both utilities are !important, so swapping the class wins cleanly.
            <div
              className={`flex-column flex-grow-1 ${activeTab === 'chat' ? 'd-flex' : 'd-none'}`}
              style={{ minHeight: 0 }}
            >
              <ChatPanel
                eventSlug={eventSlug}
                token={token}
                displayName={displayName}
                isGuest={!token}
                isModerator={isModerator}
                active={isChatActive}
                onUnreadCountChange={setChatUnread}
              />
            </div>
          )}
          {activeTab === 'polls' && (
            <PollPanel eventSlug={eventSlug} token={token} isModerator={isModerator} />
          )}
          {activeTab === 'wordcloud' && effWordCloud && (
            <WordCloud eventSlug={eventSlug} token={token} isModerator={isModerator} />
          )}
          {activeTab === 'agenda' && effAgenda && (
            <AgendaPanel
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
              canReact={canReactAgenda}
              guestId={guestId}
            />
          )}
          {activeTab === 'materials' && (
            <MaterialPanel
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
            />
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

  const closeAt = graceMinutes > 0 ? new Date(endsAtMs + graceMinutes * 60_000) : null;
  const minutesLeft = closeAt
    ? Math.max(0, Math.ceil((closeAt.getTime() - now) / 60_000))
    : null;

  const message =
    closeAt && minutesLeft !== null
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
  /** Total confirmed registrations (if known). Rendered alongside the live
   *  count as "N attivi · M registrati" ONLY for moderators (role gate at the
   *  render site); everyone else sees just the present-participant count, so
   *  the registration total is never leaked to attendees (F5). */
  registrationCount?: number;
  /** Event capacity (maxParticipants). Used by the "live / capacity"
   *  pill in the top bar and as fallback when no one has joined yet. */
  maxParticipants?: number;
  isRecording: boolean;
  role: UserRole;
  /** Event slug + active locale → build the shareable, token-free call and
   *  event-page links (never derived from the current URL, which carries the
   *  moderator/access `?token=`). */
  slug: string;
  locale: string;
  /** Privileged moderator magic-link token — passed ONLY when the current
   *  user is a moderator, so the token never enters a non-moderator tree.
   *  Surfaced (collapsed, with a warning) in the share popup. */
  moderatorToken?: string;
  onLeaveRoom?: () => void;
  /** App-owned fullscreen (#6): current state + toggle. Passed only by the
   *  live-phase top bar (the consent-pending one renders no video/sidebar). */
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

function LiveTopBar({
  title,
  parseTitleKicker = false,
  imageUrl,
  coverImageUrl,
  participantCount,
  registrationCount,
  maxParticipants: _maxParticipants,
  isRecording,
  role,
  slug,
  locale,
  moderatorToken,
  onLeaveRoom,
  isFullscreen,
  onToggleFullscreen,
}: LiveTopBarProps) {
  const t = useTranslations('live');
  const tr = useTranslations('live.role');
  const settings = useSettings();
  const brandName = settings.siteName || 'PA Webinar';
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
        {/* PA Webinar brand — the immersive call overlay deliberately hides the
            site header/footer (wrong to show full chrome over a fullscreen
            call), so surface the brand here for orientation. Non-navigating on
            purpose: a stray click must never yank the moderator out of the live
            call. Hidden below md to keep the bar lean on phones. */}
        <div
          className="d-none d-md-flex align-items-center me-3 pe-3 flex-shrink-0"
          style={{ borderRight: '1px solid rgba(255,255,255,0.25)' }}
        >
          {settings.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={settings.logoUrl}
              alt={brandName}
              style={{ height: 22, width: 'auto' }}
            />
          ) : (
            <span
              className="fw-bold text-white text-nowrap"
              style={{ fontSize: '0.9rem', letterSpacing: '0.01em' }}
            >
              {brandName}
            </span>
          )}
        </div>
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
          style={{
            backgroundColor: badgeColors.badge,
            color: badgeColors.badgeFg,
            fontSize: '0.72rem',
          }}
        >
          {tr(role)}
        </Badge>
        {/* The live people-count is intentionally NOT shown here: it was a
         *  redundant duplicate of the authoritative count in the participants
         *  sidebar and, being fed only by post-attach join/leave deltas, it
         *  under-reported (live feedback #4). The sidebar remains the single
         *  source of truth for the present-participant count. */}
      </div>
      <div className="d-flex align-items-center gap-3">
        {isRecording && (
          <Badge color="danger" pill className="px-2 py-1">
            <span className="me-1">●</span>
            {t('recordingActive')}
          </Badge>
        )}
        {/* The "active vs registered" figure is moderator-only (F5 —
            participants shouldn't see attendance numbers). The live people-count
            now lives only in the participants sidebar, so non-moderators get
            nothing extra here. `participantCount` is seeded on join and kept
            current by JitsiRoom (recorder-excluded), so this reads correctly even
            when a moderator joins an already-populated room. */}
        {role === 'moderator' && registrationCount !== undefined && registrationCount > 0 && (
          <span className="small d-none d-md-inline">
            <Icon icon="it-user" size="sm" color="white" className="me-1" />
            {t('activeVsRegistered', {
              active: participantCount,
              registered: registrationCount,
            })}
          </span>
        )}
        {onToggleFullscreen && (
          <Button
            color="light"
            outline
            size="xs"
            className="d-none d-md-inline-flex align-items-center fullscreen-toggle-btn"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
            title={isFullscreen ? t('exitFullscreen') : t('enterFullscreen')}
          >
            <Icon icon={isFullscreen ? 'it-collapse' : 'it-expand'} size="xs" color="white" />
          </Button>
        )}
        <LiveShareButton slug={slug} locale={locale} moderatorToken={moderatorToken} />
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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
      <span>
        {t('screenshareActive', {
          name: activeSharerName || t('screenshareFallbackName'),
        })}
      </span>
    </div>
  );
}
