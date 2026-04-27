'use client';

import { useCallback, useEffect, useState } from 'react';
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
  status: 'PUBLISHED' | 'LIVE' | 'ENDED';
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

const PARTICIPANT_NAME_KEY = 'eventidtd.participant.name';
const PARTICIPANT_EMAIL_KEY = 'eventidtd.participant.email';
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

  const startsAtMs = new Date(event.startsAt).getTime();
  const isLive = event.status === 'LIVE';
  const isEnded = event.status === 'ENDED';
  const isPublished = event.status === 'PUBLISHED';
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
              <h2 className="h5 fw-semibold mb-0" style={{ color: '#17324D' }}>
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

  return (
    <div className="waiting-garden-bg">
      {/* Decorative garden scene behind the card. Pure SVG + CSS
          animations, respects prefers-reduced-motion, aria-hidden so
          the card content above remains the accessible source of truth.
          ADR-012 tracks the roadmap: fase 2 adds live avatar+movement
          (see <GardenInteractive> below). */}
      <GardenScene />
      <InteractiveGardenSlot slug={event.slug} displayName={trimmedName} />
      <div className="container py-4" style={{ position: 'relative', zIndex: 1 }}>
        <div className="row justify-content-center">
          <div className="col-lg-8 col-xl-7">
            <Card className="waiting-card shadow-sm border-0 overflow-hidden" style={{ borderRadius: 16 }}>
            {/* Hero cover image (or branded gradient fallback) */}
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
                <Badge
                  color="danger"
                  pill
                  className="px-3 py-2 position-absolute"
                  style={{ top: 12, right: 12, fontSize: '0.75rem' }}
                >
                  <span className="me-1">●</span>
                  {t('eventLive')}
                </Badge>
              )}
              {isEnded && (
                <Badge
                  color=""
                  pill
                  className="px-3 py-2 position-absolute"
                  style={{
                    top: 12,
                    right: 12,
                    fontSize: '0.75rem',
                    backgroundColor: '#E9ECEF',
                    color: '#5A768A',
                  }}
                >
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
                style={{ color: '#17324D' }}
              />

              {organizerLine && (
                <p className="text-muted mb-2" style={{ fontSize: '0.9rem' }}>
                  {organizerLine}
                </p>
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

              {/* Countdown (PUBLISHED only) */}
              {isPublished && countdown && (
                <div
                  className={`rounded-3 p-3 mb-4 text-center${pulseCountdown ? ' waiting-countdown--pulse' : ''}`}
                  style={{
                    background: 'linear-gradient(135deg, #0066CC, #004080)',
                    color: '#fff',
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

              {/* JVB scaling heads-up (LIVE only) */}
              {isLive && jvbReady === false && (
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

              {/* Name input — always visible (except ENDED) */}
              {!isEnded && (
                <FormGroup className="mb-3">
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
              )}

              {/* Optional email — we don't use it server-side (the chat
                  API doesn't take it) but capturing it here enables
                  post-event follow-up (feedback, recording notifications)
                  for guests who didn't go through the registration flow. */}
              {!isEnded && (
                <FormGroup className="mb-3">
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
              )}

              {/* Device check — mic + camera preview before entering. Only
                  shown when the user is about to join live (not on ENDED). */}
              {!isEnded && (
                <div className="mb-3">
                  <DeviceCheck compact onStateChange={handleDeviceStateChange} />
                </div>
              )}

              {/* Waiting audio (PUBLISHED only, when an audio URL is set) */}
              {isPublished && event.waitingRoomAudioUrl && (
                <div className="mb-4 d-flex justify-content-center">
                  <AudioPlayer audioUrl={event.waitingRoomAudioUrl} />
                </div>
              )}

              {/* Primary CTA area */}
              {isEnded ? (
                <div className="d-grid gap-2 mb-3">
                  <h2 className="h5 fw-semibold mb-1" style={{ color: '#17324D' }}>
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
                    <Button
                      color="primary"
                      outline
                      size="lg"
                      className="fw-semibold"
                      onClick={onLeaveFeedback}
                    >
                      <Icon icon="it-star-outline" size="sm" className="me-2" />
                      {t('endedLeaveFeedback')}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="d-grid gap-2 mb-3">
                  {startError && (
                    <Alert color="danger" className="mb-0" style={{ fontSize: '0.85rem' }}>
                      {startError}
                    </Alert>
                  )}

                  {/* Moderator: START EVENT. Available in PUBLISHED at any
                      time (moderators often open the room before the
                      announced start to test audio and greet early
                      arrivals). */}
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

                  {/* Everyone: ENTER LIVE (when live or moderator starting) */}
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
                  ) : (
                    <Button
                      color="primary"
                      size="lg"
                      className="fw-semibold"
                      disabled
                    >
                      <Icon icon="it-clock" size="sm" color="white" className="me-2" />
                      {t('openingAt', { time: startTimeLabel })}
                    </Button>
                  )}

                  {/* Secondary: CATCH-UP (whenever a temp recording exists) */}
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
              )}

              {event.tempRecordingUrl && !isEnded && (
                <p className="text-muted mb-3 text-center" style={{ fontSize: '0.8rem' }}>
                  {t('watchCatchupDesc')}
                </p>
              )}

              {/* Netiquette reminder */}
              <div className="waiting-netiquette rounded-3 p-3 mb-3" style={{ backgroundColor: '#F5F7FA' }}>
                <div className="fw-semibold mb-2" style={{ color: '#17324D', fontSize: '0.9rem' }}>
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

              {/* Recording notice */}
              {event.recordingEnabled && !isEnded && (
                <Alert color="warning" className="text-start mb-3" style={{ fontSize: '0.82rem' }}>
                  <Icon icon="it-camera" size="sm" className="me-2" />
                  {t('recordingNotice')}
                </Alert>
              )}

              {/* Chat preview (LIVE only). Gated behind a valid name —
                  without this, every anonymous arrival posted as
                  "Ospite" and the chat degenerated into a crowd of
                  nameless messages. Moderators/registered participants
                  already have `nameValid` satisfied from the server-
                  provided defaultName, so they never see the gate. */}
              {showChatPreview && (
                <div
                  className="waiting-chat-preview rounded-3 overflow-hidden mb-3"
                  style={{ border: '1px solid #E2E8F0' }}
                >
                  <div className="px-3 py-2" style={{ backgroundColor: '#F5F7FA' }}>
                    <div className="fw-semibold" style={{ color: '#17324D', fontSize: '0.85rem' }}>
                      <Icon icon="it-comment" size="xs" className="me-1" />
                      {t('chatPreviewTitle')}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                      {t('chatPreviewHint')}
                    </div>
                  </div>
                  {nameValid ? (
                    <div style={{ height: 220, display: 'flex', flexDirection: 'column' }}>
                      <ChatPanel
                        eventSlug={event.slug}
                        token=""
                        displayName={trimmedName}
                        isGuest
                      />
                    </div>
                  ) : (
                    <div
                      className="d-flex flex-column align-items-center justify-content-center text-center p-4"
                      style={{ height: 220, backgroundColor: '#F5F7FA', color: '#5A768A' }}
                    >
                      <Icon icon="it-lock" size="sm" className="mb-2" />
                      <div style={{ fontSize: '0.85rem' }}>{t('chatLockedMessage')}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Back link (PUBLISHED only — once LIVE the cta dominates) */}
              {isPublished && (
                <div className="text-center">
                  <Link href={`/events/${event.slug}`}>
                    <Button color="primary" outline tag="span" size="sm">
                      <Icon icon="it-arrow-left" size="xs" className="me-1" />
                      {tc('back')}
                    </Button>
                  </Link>
                </div>
              )}

              {/* PUBLISHED auto-refresh hint */}
              {isPublished && !isModerator && (
                <p className="text-center text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
                  <Icon icon="it-refresh" size="xs" className="me-1" />
                  {t('autoRefreshHint')}
                </p>
              )}
            </CardBody>
          </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps <GardenInteractive> with a localStorage-backed "enabled"
 * flag. Kept in a tiny separate component so the main WaitingRoom
 * body doesn't have to know about the toggle state, and so users
 * who opted out of the garden experience (accessibility, low-end
 * device, personal preference) get a clean tree with zero rAF /
 * polling running.
 */
function InteractiveGardenSlot({ slug, displayName }: { slug: string; displayName: string }) {
  const [enabled, setEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem('eventidtd.garden.hidden') !== '1';
    } catch {
      return true;
    }
  });
  return (
    <GardenInteractive
      eventSlug={slug}
      displayName={displayName}
      enabled={enabled}
      onToggle={setEnabled}
    />
  );
}
