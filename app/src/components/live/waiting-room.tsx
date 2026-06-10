'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  FormGroup,
  Icon,
  Input,
  Spinner,
} from 'design-react-kit';

import { Link } from '@/i18n/navigation';
import AudioPlayer from '@/components/live/audio-player';
import ChatPanel from '@/components/live/chat-panel';
import DeviceCheck from '@/components/live/device-check';
import GardenScene from '@/components/live/garden-scene';
import GardenInteractive from '@/components/live/garden/garden-interactive';
import VideoPlayer from '@/components/events/video-player';
import EventTitle from '@/components/events/event-title';

// Experimental Phaser lobby engine (opt-in via `?engine=phaser`). Loaded
// client-only so Phaser never enters the main bundle or runs on the server.
const PhaserLobby = dynamic(() => import('@/components/live/garden/phaser-lobby'), {
  ssr: false,
});

/**
 * Unified waiting-room / front-door for the live event page.
 *
 * This is the ONE screen every first-time arrival sees (guest, registered
 * participant, moderator, speaker) no matter the event status. It replaces
 * the previous fork between `GuestJoinForm`, `PreJoinScreen` and the
 * scenario-specific waiting room, consolidating:
 *   - cover image / hero
 *   - name input (always editable, prefilled where we know it)
 *   - netiquette reminder
 *   - audio player while waiting
 *   - countdown (PUBLISHED only)
 *   - catch-up recording (whenever tempRecordingUrl is set — no 5min gate)
 *   - chat preview while LIVE
 *   - primary CTA: enter, start (moderator), watch recording, feedback
 *
 * All the heavy lifting (JWT fetch, consent flow, pre-join transitions)
 * stays in the parent `LiveEventClient` — the waiting room is a pure
 * presentation surface that calls two callbacks: `onEnterLive(name)` and
 * `onStartEvent()`.
 */

interface WaitingRoomEvent {
  title: string;
  slug: string;
  /** Resolved kicker flag (per-event override merged with site default). */
  parseTitleKicker?: boolean;
  startsAt: string;
  endsAt: string;
  status: 'PUBLISHED' | 'LIVE' | 'ENDED' | 'IDLE' | 'PROVISIONING';
  speakers?: string | null;
  organizerName?: string | null;
  moderatorName?: string | null;
  imageUrl?: string | null;
  coverImageUrl?: string | null;
  maxParticipants: number;
  recordingEnabled: boolean;
  tempRecordingUrl?: string | null;
  recordingUrl?: string | null;
  waitingRoomAudioUrl?: string | null;
  feedbackEnabled?: boolean;
  chatEnabled?: boolean;
  qaEnabled?: boolean;
  timezone?: string;
}

export interface WaitingRoomJoinPrefs {
  /** Whether the user wants their camera on when they land in Jitsi. */
  cameraOn: boolean;
  /** Whether the user wants their microphone on when they land in Jitsi. */
  micOn: boolean;
}

interface WaitingRoomProps {
  event: WaitingRoomEvent;
  participantCount: number;
  role: 'moderator' | 'participant' | 'guest';
  jvbReady?: boolean | null;
  defaultName: string;
  /** Called when the user confirms "Entra ora" / "Guarda registrazione".
   *  The name the user typed is passed through so the parent can forward
   *  it to the JWT fetch (displayNameOverride / guestName). The pre-join
   *  camera/mic preference (see DeviceCheck) travels alongside so the
   *  shell can wire it into `startWithVideoMuted`/`startWithAudioMuted`. */
  onEnterLive: (chosenName: string, prefs: WaitingRoomJoinPrefs) => void;
  onStartEvent?: () => Promise<void>;
  onLeaveFeedback?: () => void;
}

const PARTICIPANT_NAME_KEY = 'pawebinar.participant.name';
const PARTICIPANT_EMAIL_KEY = 'pawebinar.participant.email';
// Accessibility fallback: when set, the waiting room renders the static
// scrollable card instead of the full-screen walkable park. New key on
// purpose so the legacy `pawebinar.garden.hidden=1` from earlier builds
// no longer disables the (now default) game experience.
const ARCADE_CLASSIC_KEY = 'pawebinar.arcade.classic';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function WaitingRoom({
  event,
  participantCount,
  role,
  jvbReady,
  defaultName,
  onEnterLive,
  onStartEvent,
  onLeaveFeedback,
}: WaitingRoomProps) {
  const t = useTranslations('waiting');
  const tc = useTranslations('common');
  const format = useFormatter();

  const [countdown, setCountdown] = useState('');
  const [startingEvent, setStartingEvent] = useState(false);
  const [watchingCatchUp, setWatchingCatchUp] = useState(false);
  const [pulseCountdown, setPulseCountdown] = useState(false);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState('');
  // Experimental waiting-room engine: SVG garden (default) vs. Phaser lobby.
  // Opt-in via `?engine=phaser`; resolved client-side post-mount to avoid any
  // SSR/hydration mismatch.
  const [engine, setEngine] = useState<'svg' | 'phaser'>('svg');
  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('engine') === 'phaser') {
        setEngine('phaser');
      }
    } catch {
      /* ignore */
    }
  }, []);
  // Full-screen park (default) vs. static classic card (accessibility
  // fallback). Initialised false to match SSR, then synced from storage.
  const [classicView, setClassicView] = useState(false);
  // Expandable bottom drawer in arcade mode (device check, email,
  // netiquette, recording notice, chat preview).
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devicePrefs, setDevicePrefs] = useState<WaitingRoomJoinPrefs>({
    cameraOn: true,
    micOn: true,
  });
  const [startError, setStartError] = useState('');

  // Rehydrate name + email from localStorage on mount. Name is merged
  // with the server-provided default (registration displayName / grant
  // name) so anonymous guests get their last-typed name back while
  // registered participants still see the accurate greeting.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const storedName = window.localStorage.getItem(PARTICIPANT_NAME_KEY);
      if (storedName && !defaultName) {
        setName(storedName);
      }
      const storedEmail = window.localStorage.getItem(PARTICIPANT_EMAIL_KEY);
      if (storedEmail) {
        setEmail(storedEmail);
      }
    } catch {
      /* private mode / blocked storage → fall back to defaults */
    }
  }, [defaultName]);

  // Restore the classic-view preference (accessibility fallback). Done in
  // an effect (not lazy init) so SSR and the first client render agree.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (window.localStorage.getItem(ARCADE_CLASSIC_KEY) === '1') {
        setClassicView(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const startsAtMs = new Date(event.startsAt).getTime();
  const isLive = event.status === 'LIVE';
  const isEnded = event.status === 'ENDED';
  const isPublished = event.status === 'PUBLISHED';
  // IDLE = bridge scaled to zero, /wake just fired from LiveEventClient.
  // PROVISIONING = scaler picked up the wake, JVB is starting.
  // Both are short-lived "warming up" states — show a non-blocking
  // banner so the user knows entry is gated, and let them keep using
  // the rest of the room (garden, name input, device check, chat).
  const isWarmingUp = event.status === 'IDLE' || event.status === 'PROVISIONING';
  const isGuest = role === 'guest';
  const isModerator = role === 'moderator';
  const heroUrl = event.imageUrl ?? event.coverImageUrl ?? null;
  const hasRecording = !!(event.recordingUrl ?? event.tempRecordingUrl);
  const showChatPreview = isLive && (event.chatEnabled ?? true);
  // Only LIVE events admit participants into the room. Moderators in
  // PUBLISHED past startsAt get a separate "Avvia evento" action that
  // flips the status to LIVE; once that happens this flag re-opens.
  const canEnterLive = isLive;
  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2;
  const trimmedEmail = email.trim();
  const emailValid = trimmedEmail.length === 0 || EMAIL_RE.test(trimmedEmail);
  const canEnter = nameValid && emailValid;

  // Countdown tick: only needed while PUBLISHED. Live / ended do not use it.
  useEffect(() => {
    if (!isPublished) {
      setCountdown('');
      setPulseCountdown(false);
      return;
    }
    const tick = () => {
      const now = Date.now();
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
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isPublished, startsAtMs]);

  const handleStartEvent = useCallback(async () => {
    if (!onStartEvent) return;
    setStartingEvent(true);
    setStartError('');
    try {
      await onStartEvent();
    } catch {
      setStartError(t('startEventError'));
      setStartingEvent(false);
    }
  }, [onStartEvent, t]);

  const handleEnterLive = useCallback(() => {
    if (!canEnter) return;
    // Persist the last-used identity so guests don't have to retype on
    // reconnects / accidental reloads.
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(PARTICIPANT_NAME_KEY, trimmedName);
        if (trimmedEmail) {
          window.localStorage.setItem(PARTICIPANT_EMAIL_KEY, trimmedEmail);
        } else {
          window.localStorage.removeItem(PARTICIPANT_EMAIL_KEY);
        }
      } catch {
        /* ignore */
      }
    }
    onEnterLive(trimmedName, devicePrefs);
  }, [canEnter, onEnterLive, trimmedName, trimmedEmail, devicePrefs]);

  const handleDeviceStateChange = useCallback(
    (s: WaitingRoomJoinPrefs) => setDevicePrefs(s),
    [],
  );

  // ── Catch-up recording player ─────────────────────────────────────
  if (watchingCatchUp && event.tempRecordingUrl) {
    return (
      <div className="container py-4">
        <div className="row justify-content-center">
          <div className="col-lg-10 col-xl-8">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h5 fw-semibold mb-0" style={{ color: 'var(--app-text)' }}>
                {event.title}
              </h2>
              <Button
                color="success"
                size="sm"
                className="fw-semibold"
                onClick={() => {
                  setWatchingCatchUp(false);
                  handleEnterLive();
                }}
              >
                <Icon icon="it-video" size="xs" color="white" className="me-1" />
                {t('enterLive')}
              </Button>
            </div>
            <VideoPlayer src={event.tempRecordingUrl} title={event.title} />
            <div className="mt-3 text-center">
              <Button
                color="primary"
                className="fw-semibold px-4"
                onClick={() => {
                  setWatchingCatchUp(false);
                  handleEnterLive();
                }}
              >
                {t('switchToLive')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Unified waiting-room layout ───────────────────────────────────
  const organizerLine = [event.speakers, event.organizerName]
    .filter((v): v is string => !!v && v.length > 0)
    .join(' · ');

  const startTimeLabel = format.dateTime(new Date(event.startsAt), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: event.timezone,
  });
  const endTimeLabel = format.dateTime(new Date(event.endsAt), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: event.timezone,
  });
  const dateLabel = format.dateTime(new Date(event.startsAt), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: event.timezone,
  });

  // ── Toggle between the full-screen park and the static classic card ──
  const toggleClassic = (on: boolean) => {
    setClassicView(on);
    try {
      if (on) window.localStorage.setItem(ARCADE_CLASSIC_KEY, '1');
      else window.localStorage.removeItem(ARCADE_CLASSIC_KEY);
    } catch {
      /* ignore */
    }
  };

  // ── Shared interactive pieces, reused by the arcade dock/drawer and the
  //   classic card so there's a single source of truth for the form + CTA.
  const nameField = (
    <FormGroup className="mb-0">
      <Input
        id="waiting-name"
        label={t('nameLabel')}
        type="text"
        value={name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
        required
        minLength={2}
        maxLength={100}
      />
      {isGuest && (
        <small className="text-muted" style={{ fontSize: '0.8rem' }}>
          {t('nameHelp')}
        </small>
      )}
    </FormGroup>
  );

  const emailField = (
    <FormGroup className="mb-0">
      <Input
        id="waiting-email"
        label={t('emailLabel')}
        type="email"
        value={email}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
        maxLength={200}
        aria-invalid={!emailValid}
        autoComplete="email"
      />
      <small className="text-muted" style={{ fontSize: '0.8rem' }}>
        {t('emailHelp')}
      </small>
      {!emailValid && (
        <div className="small text-danger mt-1" style={{ fontSize: '0.8rem' }}>
          {t('emailInvalid')}
        </div>
      )}
    </FormGroup>
  );

  const deviceCheckField = <DeviceCheck compact onStateChange={handleDeviceStateChange} />;

  const netiquetteBlock = (
    <div className="waiting-netiquette rounded-3 p-3" style={{ backgroundColor: '#F5F7FA' }}>
      <div className="fw-semibold mb-2" style={{ color: 'var(--app-text)', fontSize: '0.9rem' }}>
        <Icon icon="it-info-circle" size="xs" className="me-1" />
        {t('netiquetteTitle')}
      </div>
      <ul className="mb-0 ps-3" style={{ fontSize: '0.85rem', color: '#455B71' }}>
        <li>{t('netiquetteBullet1')}</li>
        <li>{t('netiquetteBullet2')}</li>
        <li>{t('netiquetteBullet3')}</li>
        <li>{t('netiquetteBullet4')}</li>
      </ul>
    </div>
  );

  const recordingNoticeBlock = event.recordingEnabled && !isEnded ? (
    <Alert color="warning" className="text-start mb-0" style={{ fontSize: '0.82rem' }}>
      <Icon icon="it-camera" size="sm" className="me-2" />
      {t('recordingNotice')}
    </Alert>
  ) : null;

  const chatPreviewBlock = showChatPreview ? (
    <div className="waiting-chat-preview rounded-3 overflow-hidden" style={{ border: '1px solid #E2E8F0' }}>
      <div className="px-3 py-2" style={{ backgroundColor: '#F5F7FA' }}>
        <div className="fw-semibold" style={{ color: 'var(--app-text)', fontSize: '0.85rem' }}>
          <Icon icon="it-comment" size="xs" className="me-1" />
          {t('chatPreviewTitle')}
        </div>
        <div className="text-muted" style={{ fontSize: '0.75rem' }}>
          {t('chatPreviewHint')}
        </div>
      </div>
      {nameValid ? (
        <div style={{ height: 220, display: 'flex', flexDirection: 'column' }}>
          <ChatPanel eventSlug={event.slug} token="" displayName={trimmedName} isGuest />
        </div>
      ) : (
        <div
          className="d-flex flex-column align-items-center justify-content-center text-center p-4"
          style={{ height: 220, backgroundColor: '#F5F7FA', color: 'var(--app-muted)' }}
        >
          <Icon icon="it-lock" size="sm" className="mb-2" />
          <div style={{ fontSize: '0.85rem' }}>{t('chatLockedMessage')}</div>
        </div>
      )}
    </div>
  ) : null;

  const backLinkBlock = isPublished ? (
    <Link href={`/events/${event.slug}`}>
      <Button color="primary" outline tag="span" size="sm">
        <Icon icon="it-arrow-left" size="xs" className="me-1" />
        {tc('back')}
      </Button>
    </Link>
  ) : null;

  // Status banners (warm-up / JVB scaling). Each Alert is mb-0; only one
  // is ever visible at a time (warming-up implies not LIVE, JVB only LIVE).
  const statusBanners = (
    <>
      {isLive && jvbReady === false && (
        <Alert color="warning" className="text-start mb-0" style={{ fontSize: '0.85rem' }}>
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
      {isWarmingUp && (
        <Alert color="info" className="text-start mb-0" style={{ fontSize: '0.85rem' }}>
          <div className="d-flex align-items-start">
            <Spinner active small className="me-2 mt-1 flex-shrink-0" />
            <div>
              <strong>{t('warmingUp')}</strong>
              <br />
              {t('warmingUpDetail')}
            </div>
          </div>
        </Alert>
      )}
    </>
  );

  // Primary CTA (non-ended): start (moderator) / enter live / warming-up /
  // scheduled-opening disabled state, plus optional catch-up.
  const primaryCta = (
    <div className="d-grid gap-2">
      {startError && (
        <Alert color="danger" className="mb-0" style={{ fontSize: '0.85rem' }}>
          {startError}
        </Alert>
      )}
      {isPublished && isModerator && onStartEvent && (
        <Button
          color="success"
          size="lg"
          className="fw-semibold"
          onClick={handleStartEvent}
          disabled={startingEvent}
        >
          {startingEvent ? (
            <>
              <Spinner active small className="me-2" />
              {t('startingEvent')}
            </>
          ) : (
            <>
              <Icon icon="it-video" size="sm" color="white" className="me-2" />
              {t('startEventButton')}
            </>
          )}
        </Button>
      )}
      {canEnterLive ? (
        <Button
          color="primary"
          size="lg"
          className="fw-semibold"
          onClick={handleEnterLive}
          disabled={!canEnter}
        >
          <Icon icon="it-video" size="sm" color="white" className="me-2" />
          {t('joinNowBtn')}
        </Button>
      ) : isWarmingUp ? (
        <Button color="primary" size="lg" className="fw-semibold" disabled>
          <Spinner active small className="me-2" />
          {t('warmingUpButton')}
        </Button>
      ) : (
        <Button color="primary" size="lg" className="fw-semibold" disabled>
          <Icon icon="it-clock" size="sm" color="white" className="me-2" />
          {t('openingAt', { time: startTimeLabel })}
        </Button>
      )}
      {event.tempRecordingUrl && (
        <Button
          color="success"
          outline
          size="lg"
          className="fw-semibold"
          onClick={() => setWatchingCatchUp(true)}
        >
          <span className="me-2">⏪</span>
          {t('watchCatchup')}
        </Button>
      )}
    </div>
  );

  // ── Classic / accessibility layout (also used for ENDED) ──
  // Static, scrollable card. No interactive avatar — decorative scene
  // only. Reached via the "Vista classica" toggle or when the event has
  // ENDED (no point playing in a concluded room).
  if (isEnded || classicView) {
    return (
      <div className="waiting-classic">
        <GardenScene />
        <div className="container py-4 waiting-classic__content">
          <div className="row justify-content-center">
            <div className="col-lg-8 col-xl-7">
              {!isEnded && (
                <div className="text-center mb-3">
                  <Button
                    color="primary"
                    outline
                    size="sm"
                    className="fw-semibold"
                    onClick={() => toggleClassic(false)}
                  >
                    <Icon icon="it-arrow-left" size="xs" className="me-1" />
                    {t('backToGarden')}
                  </Button>
                </div>
              )}
              <div className="waiting-card-frame">
                <span className="waiting-card-flag waiting-card-flag--left" aria-hidden="true">
                  <svg viewBox="0 0 14 38" width="14" height="38" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6" y="0" width="2" height="38" fill="#5A4029" />
                    <circle cx="7" cy="1" r="2" fill="#F7A11A" />
                    <path d="M8 4 L14 8 L8 12 Z" fill="#008758" />
                    <path d="M8 12 L14 16 L8 20 Z" fill="#F5F7FB" />
                    <path d="M8 20 L14 24 L8 28 Z" fill="#D9364F" />
                  </svg>
                </span>
                <span className="waiting-card-flag waiting-card-flag--right" aria-hidden="true">
                  <svg viewBox="0 0 14 38" width="14" height="38" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6" y="0" width="2" height="38" fill="#5A4029" />
                    <circle cx="7" cy="1" r="2" fill="#F7A11A" />
                    <path d="M6 4 L0 8 L6 12 Z" fill="#008758" />
                    <path d="M6 12 L0 16 L6 20 Z" fill="#F5F7FB" />
                    <path d="M6 20 L0 24 L6 28 Z" fill="#D9364F" />
                  </svg>
                </span>
                <Card className="waiting-card shadow-sm border-0 overflow-hidden" style={{ borderRadius: 16 }}>
                  <div
                    className="waiting-hero"
                    style={{
                      height: 180,
                      background: heroUrl
                        ? `url("${heroUrl}") center/cover no-repeat`
                        : 'linear-gradient(135deg, #0066CC, #004080)',
                      position: 'relative',
                    }}
                    aria-hidden={!heroUrl}
                  >
                    {isLive && (
                      <Badge color="danger" pill className="px-3 py-2 position-absolute" style={{ top: 12, right: 12, fontSize: '0.75rem' }}>
                        <span className="me-1">●</span>
                        {t('eventLive')}
                      </Badge>
                    )}
                    {isEnded && (
                      <Badge color="" pill className="px-3 py-2 position-absolute" style={{ top: 12, right: 12, fontSize: '0.75rem', backgroundColor: '#E9ECEF', color: 'var(--app-muted)' }}>
                        {t('endedTitle')}
                      </Badge>
                    )}
                  </div>

                  <CardBody className="p-4 p-md-5">
                    <EventTitle
                      title={event.title}
                      kickerEnabled={event.parseTitleKicker ?? false}
                      as="h1"
                      className="h4 fw-bold mb-2"
                      style={{ color: 'var(--app-text)' }}
                    />

                    {organizerLine && (
                      <p className="text-muted mb-2" style={{ fontSize: '0.9rem' }}>{organizerLine}</p>
                    )}

                    {event.moderatorName && (
                      <p className="text-muted mb-2" style={{ fontSize: '0.85rem' }}>
                        <Icon icon="it-user" size="xs" className="me-1" />
                        {t('moderatedBy', { name: event.moderatorName })}
                      </p>
                    )}

                    <div className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
                      <Icon icon="it-calendar" size="xs" className="me-1" />
                      {dateLabel}
                      {' · '}
                      {startTimeLabel} – {endTimeLabel}
                    </div>

                    {participantCount > 0 && (
                      <div className="text-muted mb-3" style={{ fontSize: '0.9rem' }}>
                        <Icon icon="it-user" size="xs" className="me-1" />
                        {isLive
                          ? t('connectedParticipants', { count: participantCount })
                          : t('peopleWaiting', { count: participantCount })}
                      </div>
                    )}

                    {isPublished && countdown && (
                      <div
                        className={`rounded-3 p-3 mb-4 text-center${pulseCountdown ? ' waiting-countdown--pulse' : ''}`}
                        style={{ background: 'linear-gradient(135deg, #0066CC, #004080)', color: '#fff' }}
                      >
                        <div className="small text-uppercase mb-1 opacity-75">{t('startsIn')}</div>
                        <div className="display-6 fw-bold font-monospace">{countdown}</div>
                      </div>
                    )}

                    {(isWarmingUp || (isLive && jvbReady === false)) && (
                      <div className="mb-4">{statusBanners}</div>
                    )}

                    {!isEnded && <div className="mb-3">{nameField}</div>}
                    {!isEnded && <div className="mb-3">{emailField}</div>}
                    {!isEnded && <div className="mb-3">{deviceCheckField}</div>}

                    {isPublished && event.waitingRoomAudioUrl && (
                      <div className="mb-4 d-flex justify-content-center">
                        <AudioPlayer audioUrl={event.waitingRoomAudioUrl} />
                      </div>
                    )}

                    {isEnded ? (
                      <div className="d-grid gap-2 mb-3">
                        <h2 className="h5 fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
                          {t('endedTitle')}
                        </h2>
                        {hasRecording && (
                          <a
                            className="btn btn-primary btn-lg fw-semibold"
                            href={event.recordingUrl ?? event.tempRecordingUrl ?? '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Icon icon="it-video" size="sm" color="white" className="me-2" />
                            {t('endedWatchRecording')}
                          </a>
                        )}
                        {(event.feedbackEnabled ?? true) && onLeaveFeedback && (
                          <Button color="primary" outline size="lg" className="fw-semibold" onClick={onLeaveFeedback}>
                            <Icon icon="it-star-outline" size="sm" className="me-2" />
                            {t('endedLeaveFeedback')}
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="mb-3">{primaryCta}</div>
                    )}

                    {event.tempRecordingUrl && !isEnded && (
                      <p className="text-muted mb-3 text-center" style={{ fontSize: '0.8rem' }}>
                        {t('watchCatchupDesc')}
                      </p>
                    )}

                    <div className="mb-3">{netiquetteBlock}</div>
                    {recordingNoticeBlock && <div className="mb-3">{recordingNoticeBlock}</div>}
                    {chatPreviewBlock && <div className="mb-3">{chatPreviewBlock}</div>}
                    {backLinkBlock && <div className="text-center">{backLinkBlock}</div>}

                    {isPublished && !isModerator && (
                      <p className="text-center text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
                        <Icon icon="it-refresh" size="xs" className="me-1" />
                        {t('autoRefreshHint')}
                      </p>
                    )}
                  </CardBody>
                </Card>
                <div className="waiting-card-base" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Experimental Phaser lobby engine (opt-in, replaces the arcade) ──
  if (engine === 'phaser') {
    return (
      <PhaserLobby
        eventSlug={event.slug}
        displayName={trimmedName}
        status={event.status}
        startsAtMs={startsAtMs}
        isHost={isModerator}
        onEnterLive={(chosenName, prefs) => {
          // Persist the name the user settled on inside the lobby, mirroring the
          // SVG path's handleEnter, before handing off to the consent/Jitsi flow.
          try {
            if (chosenName.trim().length >= 2) {
              window.localStorage.setItem(PARTICIPANT_NAME_KEY, chosenName.trim());
            }
          } catch {
            /* ignore */
          }
          onEnterLive(chosenName, prefs);
        }}
        // Go straight to the simple static classic card (not the intermediate
        // SVG arcade). Its own back button returns here to the Phaser lobby.
        onExitClassic={() => toggleClassic(true)}
      />
    );
  }

  // ── Full-screen walkable park (default experience) ──
  return (
    <div className="waiting-arcade">
      {/* The park fills the viewport; the avatar is the protagonist and
          is walkable from the first second (see <GardenInteractive>). The
          functional UI floats over the stage in the topbar/dock/drawer. */}
      <div className="arcade-stage">
        <GardenScene />
        <GardenInteractive eventSlug={event.slug} displayName={trimmedName} />
      </div>

      {/* Top bar: event identity + countdown / status + classic toggle */}
      <div className="arcade-topbar">
        <div className="arcade-topbar__info">
          <EventTitle
            title={event.title}
            kickerEnabled={event.parseTitleKicker ?? false}
            as="h1"
            className="h6 fw-bold mb-0 arcade-topbar__title"
          />
          <div className="arcade-topbar__meta">
            <Icon icon="it-calendar" size="xs" className="me-1" />
            {dateLabel} · {startTimeLabel}–{endTimeLabel}
            {organizerLine ? ` · ${organizerLine}` : ''}
          </div>
        </div>
        <div className="arcade-topbar__status">
          {isPublished && countdown && (
            <span className={`arcade-chip${pulseCountdown ? ' arcade-chip--pulse' : ''}`}>
              <span className="arcade-chip__label">{t('startsIn')}</span>
              <strong className="font-monospace">{countdown}</strong>
            </span>
          )}
          {isLive && (
            <span className="arcade-chip arcade-chip--live">
              <span className="me-1" aria-hidden="true">●</span>
              {t('eventLive')}
            </span>
          )}
          <button type="button" className="arcade-classic-btn" onClick={() => toggleClassic(true)}>
            <Icon icon="it-list" size="xs" className="me-1" />
            {t('classicView')}
          </button>
        </div>
      </div>

      {/* Bottom dock: (expandable drawer) + name + primary CTA + toggle.
          The drawer lives inside the dock so the panel grows upward
          (the dock is pinned to the bottom) and scrolls internally. */}
      <div className="arcade-dock">
        {drawerOpen && (
          <div className="arcade-drawer" id="arcade-drawer" role="region" aria-label={t('details')}>
            <div className="arcade-drawer__inner">
              <div className="row g-3">
                <div className="col-12 col-md-6">{emailField}</div>
                <div className="col-12 col-md-6">{deviceCheckField}</div>
              </div>
              {netiquetteBlock}
              {recordingNoticeBlock}
              {chatPreviewBlock}
              {backLinkBlock && <div className="text-center">{backLinkBlock}</div>}
            </div>
          </div>
        )}
        {(isWarmingUp || (isLive && jvbReady === false)) && (
          <div className="arcade-dock__banners">{statusBanners}</div>
        )}
        <div className="arcade-dock__row">
          <div className="arcade-dock__name">{nameField}</div>
          <div className="arcade-dock__cta">{primaryCta}</div>
        </div>
        <button
          type="button"
          className="arcade-dock__more"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
          aria-controls="arcade-drawer"
        >
          <Icon icon={drawerOpen ? 'it-collapse' : 'it-expand'} size="xs" className="me-1" />
          {drawerOpen ? t('hideDetails') : t('details')}
        </button>
      </div>
    </div>
  );
}
