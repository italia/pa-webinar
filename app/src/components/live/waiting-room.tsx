'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { resolveWaitingRoomMode } from '@/lib/waiting-room/resolve-engine';
import AudioPlayer from '@/components/live/audio-player';
import ChatPanel from '@/components/live/chat-panel';
import DeviceCheck from '@/components/live/device-check';
import VideoPlayer from '@/components/events/video-player';
import EventTitle from '@/components/events/event-title';

// Experimental Phaser lobby engine (opt-in via `?engine=phaser`). Loaded
// client-only so Phaser never enters the main bundle or runs on the server.
const PhaserLobby = dynamic(() => import('@/components/live/garden/phaser-lobby'), {
  ssr: false,
});

// (Il giardino SVG minimale che stava nel riquadro laterale è stato rimosso:
// for ended/multitrack events). Loaded client-only so the garden JS only ships
// once the game box is actually rendered with `engine === 'svg'`, not on every
// waiting-room load.

/**
 * Error boundary around the Phaser lobby. Phaser is a lazy chunk (~1MB) loaded
 * over PA networks; if the chunk fails to load or the game throws at runtime,
 * we degrade to the accessible CLASSIC card (via `onError`) instead of leaving
 * a blank box. Renders nothing while erroring, until the parent swaps engines.
 */
class PhaserLobbyBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { errored: boolean }
> {
  state = { errored: false };
  static getDerivedStateFromError(): { errored: boolean } {
    return { errored: true };
  }
  componentDidCatch(): void {
    this.props.onError();
  }
  render(): ReactNode {
    return this.state.errored ? null : this.props.children;
  }
}

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
  /** Resolved waiting-room engine (per-event override merged with the site
   *  default). GARDEN = SVG garden, GAME = Phaser videogame lobby, CLASSIC =
   *  static accessible card. Defaults to GARDEN when absent. */
  waitingRoomEngine?: 'GARDEN' | 'GAME' | 'CLASSIC';
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
  /** L'evento verrà processato dalla pipeline AI post-evento → mostra
   *  l'informativa in sala d'attesa (AI Act / GDPR trasparenza). */
  aiPostprodEnabled?: boolean;
  /** Testo custom per-locale dell'informativa AI; vuoto/null → fallback i18n. */
  aiConsentDisclosure?: string | null;
  /** L'evento registra una traccia audio separata per partecipante:
   *  richiede consenso esplicito (hard-gate) prima di entrare. */
  multitrackRecordingEnabled?: boolean;
}

export interface WaitingRoomJoinPrefs {
  /** Whether the user wants their camera on when they land in Jitsi. */
  cameraOn: boolean;
  /** Whether the user wants their microphone on when they land in Jitsi. */
  micOn: boolean;
}

/** Telemetria warm-up dal poll /lifecycle: alimenta il pannello di attesa
 *  onesto (fase + tempo trascorso) al posto dello spinner cieco. */
export interface WaitingRoomWarmup {
  phase: 'queued' | 'starting' | 'ready';
  /** Stopwatch anchor, già ripulito lato server: valorizzato solo mentre
   *  PROVISIONING e recente (null in IDLE / se residuo di un ciclo passato),
   *  così il cronometro non parte mai da un timestamp stantìo. */
  startedAt: string | null;
  serverTime: string;
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
  /** Telemetria warm-up (null fuori da IDLE/PROVISIONING). */
  warmup?: WaitingRoomWarmup | null;
  /** Uscita esplicita dalla sala: pagina evento (scheduled) o home (instant). */
  exitHref?: string;
  /** True se il consenso multitrack NON va richiesto qui: il moderatore
   *  (configura e controlla la registrazione) e i partecipanti registrati che
   *  hanno già prestato il consenso alla registrazione. Gli SPEAKER non sono
   *  esenti: non controllano la registrazione e la loro traccia isolata è il
   *  dato che il gate protegge. Evita il doppio consenso e riabilita il
   *  minigioco. */
  multitrackConsentExempt?: boolean;
  /** Token dell'utente (moderatore/iscritto) da usare per leggere e scrivere in
   *  chat durante l'attesa. Vuoto per un ospite senza credenziali. */
  chatToken?: string;
  /** Serve a sapere se la chat è leggibile prima del LIVE: le call INSTANT sono
   *  aperte per link e ammettono ospiti già durante il warm-up, un evento
   *  schedulato no (vedi lib/chat/read-access). */
  eventType?: 'SCHEDULED' | 'INSTANT';
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
  warmup = null,
  exitHref,
  multitrackConsentExempt = false,
  chatToken = '',
  eventType = 'SCHEDULED',
}: WaitingRoomProps) {
  const t = useTranslations('waiting');
  const tc = useTranslations('common');
  const tGdpr = useTranslations('gdpr.consent');
  const format = useFormatter();

  const [countdown, setCountdown] = useState('');
  const [startingEvent, setStartingEvent] = useState(false);
  const [watchingCatchUp, setWatchingCatchUp] = useState(false);
  const [pulseCountdown, setPulseCountdown] = useState(false);
  // PUBLISHED con orario di inizio già passato ma il moderatore non ha ancora
  // premuto "Avvia evento": mostriamo uno stato dedicato invece del countdown
  // vuoto + CTA "Apertura alle {ora passata}" (incoerente e sfiduciante).
  const [startingSoon, setStartingSoon] = useState(false);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState('');
  // Full-screen park (default) vs. static classic card (accessibility
  // fallback). Initialised false to match SSR, then synced from storage.
  const [classicView, setClassicView] = useState(false);
  // La piazza/giardino si apre su richiesta: vedi il commento su gameInvite.
  const [gameOpen, setGameOpen] = useState(false);
  const [devicePrefs, setDevicePrefs] = useState<WaitingRoomJoinPrefs>({
    cameraOn: true,
    micOn: true,
  });
  const [startError, setStartError] = useState('');
  // Consenso esplicito alla registrazione per-partecipante (multitrack).
  const [multitrackConsent, setMultitrackConsent] = useState(false);
  // "La sala è aperta" cue: a short 3→2→1 countdown shown to a waiting
  // participant the moment the event flips to LIVE, so the now-active
  // "Entra ora" CTA can't slip by unnoticed (the old behaviour silently
  // re-enabled the button). Purely presentational — it never auto-enters
  // (iOS gesture + multitrack consent are still required on the tap).
  const prevStatusRef = useRef(event.status);
  const [liveCountdown, setLiveCountdown] = useState<number | null>(null);
  // Cronometro onesto del warm-up: base ancorata all'orologio del SERVER
  // (serverTime - provisioningStartedAt, dal poll /lifecycle) così lo skew
  // del client non inventa attese negative o gonfiate; il tick locale
  // aggiunge i secondi tra un poll e l'altro.
  const [warmupElapsed, setWarmupElapsed] = useState<number | null>(null);

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

  // Resolve the waiting-room engine + classic-view post-mount, in priority
  // order (highest first):
  //   1. `?engine=` URL param (manual override: phaser | svg | classic)
  //   2. the user's "Versione classica" localStorage preference (accessibility)
  //   3. the configured default — per-event override merged with the site
  //      default, arriving resolved on `event.waitingRoomEngine`
  //   4. GARDEN
  // Ora c'è un solo gioco: GARDEN e GAME sono equivalenti ("piazza disponibile"),
  // CLASSIC la disattiva del tutto.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      // PHONES (coarse pointer AND narrow viewport) default to the accessible
      // CLASSIC card: the walkable park + joystick don't work well on small
      // touch screens, and the classic layout shows the real controls (name,
      // email, device check) inline instead of hiding them in the arcade
      // drawer. Tablets (coarse pointer but wider than 768px) keep the rich
      // room. Precedence + the `?engine=` escape hatch live in the pure helper.
      const mode = resolveWaitingRoomMode({
        configured: event.waitingRoomEngine ?? 'GARDEN',
        urlEngine: new URLSearchParams(window.location.search).get('engine'),
        isPhone:
          window.matchMedia?.('(pointer: coarse) and (max-width: 768px)')?.matches ??
          false,
        classicPref: window.localStorage.getItem(ARCADE_CLASSIC_KEY) === '1',
      });
      // Con un solo gameplay, GARDEN e GAME significano entrambi "la piazza è
      // disponibile"; CLASSIC resta l'uscita di sicurezza per telefoni e per chi
      // ha scelto la versione accessibile.
      setClassicView(mode === 'CLASSIC');
    } catch {
      /* ignore */
    }
  }, [event.waitingRoomEngine]);

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
  // La chat è app-side e NON dipende dal bridge: mentre la sala si scalda
  // (IDLE/PROVISIONING) chi aspetta può già chiacchierare — è la differenza
  // tra un'attesa cieca e una sala d'attesa vera.
  // La chat è leggibile prima del LIVE solo da chi ha un token (moderatore o
  // iscritto) oppure, senza token, nelle call INSTANT — le stesse condizioni
  // che il server applica in lettura E in scrittura (lib/chat/read-access).
  // Mostrarla anche agli altri significherebbe un riquadro vuoto e permanente:
  // né i messaggi né l'invio funzionerebbero.
  const canReadChatNow = isLive || !!chatToken || eventType === 'INSTANT';
  const showChatPreview =
    (isLive || isWarmingUp) && (event.chatEnabled ?? true) && canReadChatNow;
  // Only LIVE events admit participants into the room. Moderators in
  // PUBLISHED past startsAt get a separate "Avvia evento" action that
  // flips the status to LIVE; once that happens this flag re-opens.
  const canEnterLive = isLive;
  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= 2;
  const trimmedEmail = email.trim();
  const emailValid = trimmedEmail.length === 0 || EMAIL_RE.test(trimmedEmail);
  // Consenso multitrack: se l'evento registra una traccia per partecipante
  // (audio isolato, dato quasi-biometrico — ADR-013/GDPR art.9), l'ingresso è
  // gated da un consenso esplicito. Niente consenso → niente ingresso.
  const multitrackRequired =
    !!event.multitrackRecordingEnabled && !isEnded && !multitrackConsentExempt;
  const canEnter =
    nameValid && emailValid && (!multitrackRequired || multitrackConsent);

  // Cronometro warm-up. Ci si ancora UNA volta per ciclo (identità =
  // warmup.startedAt): senza questo, ri-ancorarsi a ogni poll (3s) fa
  // sobbalzare/tornare indietro il tempo per via del jitter di rete. La base
  // server (serverTime - startedAt) la leggiamo da un ref così un nuovo poll
  // aggiorna la fase senza far ripartire il tick. startedAt null (IDLE /
  // residuo stantìo, già filtrato dal server) → niente cronometro.
  const warmupStartedAt = warmup?.startedAt ?? null;
  const warmupRef = useRef(warmup);
  warmupRef.current = warmup;
  useEffect(() => {
    if (!isWarmingUp || !warmupStartedAt) {
      setWarmupElapsed(null);
      return;
    }
    const serverNowMs = new Date(
      warmupRef.current?.serverTime ?? warmupStartedAt,
    ).getTime();
    const base = Math.max(
      0,
      (serverNowMs - new Date(warmupStartedAt).getTime()) / 1000,
    );
    const anchor = Date.now();
    const tick = () =>
      setWarmupElapsed(Math.floor(base + (Date.now() - anchor) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isWarmingUp, warmupStartedAt]);

  // Countdown tick: only needed while PUBLISHED. Live / ended do not use it.
  useEffect(() => {
    if (!isPublished) {
      setCountdown('');
      setPulseCountdown(false);
      setStartingSoon(false);
      return;
    }
    const tick = () => {
      const now = Date.now();
      const diff = startsAtMs - now;
      if (diff <= 0) {
        setCountdown('');
        setPulseCountdown(false);
        setStartingSoon(true);
        return;
      }
      setStartingSoon(false);
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

  // Detect the transition into LIVE while the user is still waiting. The
  // moderator who pressed "Avvia evento" doesn't need the cue (they know),
  // so it's participant/guest-only.
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = event.status;
    if (event.status === 'LIVE' && prev !== 'LIVE' && !isModerator) {
      setLiveCountdown(3);
    }
  }, [event.status, isModerator]);

  // Drive the 3→2→1 cue, then clear it (the active CTA stays put after).
  useEffect(() => {
    if (liveCountdown === null) return;
    if (liveCountdown <= 0) {
      setLiveCountdown(null);
      return;
    }
    const id = setTimeout(
      () => setLiveCountdown((n) => (n === null ? null : n - 1)),
      1000,
    );
    return () => clearTimeout(id);
  }, [liveCountdown]);

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

  // Entry triggered from INSIDE the Phaser game (walking the avatar into the
  // open gate). It funnels through the SAME validated handleEnterLive as the
  // standard button — never the raw onEnterLive — so name/consent and device
  // prefs are always honoured. When the form isn't complete yet we guide the
  // user to it and THROW: the game's join state machine treats a rejected
  // conference.join as "not joined" and resets, so the avatar is never left
  // phantom-seated when the host never actually entered. The standard "Entra
  // ora" button stays available for anyone who doesn't want to play.
  //
  // The `(name, prefs)` the lobby passes are deliberately IGNORED, and that is
  // only safe because the lobby runs with `hostOwnsEntry`: its own name field
  // and device panel are suppressed, so those arguments are the profile we
  // pushed in and a pair of placeholder muted flags. Drop that prop and the
  // game grows a second set of controls whose answers land nowhere — a
  // participant who muted camera and mic in there would join with both live.
  const handleGameEnter = useCallback(() => {
    if (canEnter) {
      handleEnterLive();
      return;
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('waiting-name') as HTMLInputElement | null;
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    throw new Error('waiting-room: pre-join not complete');
  }, [canEnter, handleEnterLive]);

  const handleDeviceStateChange = useCallback(
    (s: WaitingRoomJoinPrefs) => setDevicePrefs(s),
    [],
  );

  // La piazza a piena pagina è un dialogo, non solo un div che copre tutto:
  // chi naviga da tastiera deve poterci entrare e — soprattutto — uscirne.
  const gameDialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gameOpen) return;
    gameDialogRef.current
      ?.querySelector<HTMLElement>('.wr-game-full__exit')
      ?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGameOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameOpen]);

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

  // NIENTE <Icon> dentro <Alert>: Bootstrap Italia disegna già un'icona via
  // ::before (padding-left:4em riservato) e un Icon inline si sovrappone
  // (vedi memoria feedback_bootstrap-italia-alert). Solo testo, come
  // aiNoticeBlock.
  const recordingNoticeBlock = event.recordingEnabled && !isEnded ? (
    <Alert color="warning" className="text-start mb-0" style={{ fontSize: '0.82rem' }}>
      {t('recordingNotice')}
    </Alert>
  ) : null;

  // Informativa AI in sala d'attesa: mostrata quando l'evento usa la
  // pipeline AI post-evento. Testo custom dell'admin (per-locale) con
  // fallback al testo generico i18n. NIENTE <Icon> dentro <Alert>:
  // Bootstrap Italia ne disegna già una via ::before (vedi memoria
  // feedback_bootstrap-italia-alert).
  const aiConsentText =
    event.aiConsentDisclosure && event.aiConsentDisclosure.trim()
      ? event.aiConsentDisclosure
      : t('aiNotice');
  const aiNoticeBlock = event.aiPostprodEnabled && !isEnded ? (
    <Alert color="info" className="text-start mb-0" style={{ fontSize: '0.82rem' }}>
      <span className="fw-semibold d-block mb-1">{t('aiNoticeTitle')}</span>
      {aiConsentText}
    </Alert>
  ) : null;

  // Consenso esplicito alla registrazione per-partecipante (multitrack):
  // hard-gate. Senza la spunta, `canEnter` è false e il CTA resta disabilitato
  // → non si entra. Non è un <Alert> (serve un input + evita l'icona ::before).
  const multitrackConsentBlock = multitrackRequired ? (
    <div
      className="rounded-3 p-3 text-start"
      style={{ background: '#FFF8E6', border: '1px solid #E0C97A' }}
    >
      <div
        className="fw-semibold mb-2"
        style={{ color: 'var(--app-text)', fontSize: '0.9rem' }}
      >
        {t('multitrackConsentTitle')}
      </div>
      <div className="form-check mb-0">
        <input
          className="form-check-input"
          type="checkbox"
          id="waiting-multitrack-consent"
          checked={multitrackConsent}
          onChange={(e) => setMultitrackConsent(e.target.checked)}
        />
        <label
          className="form-check-label"
          htmlFor="waiting-multitrack-consent"
          style={{ fontSize: '0.84rem', color: '#455B71' }}
        >
          {tGdpr('multitrack')}
        </label>
      </div>
      {!multitrackConsent && (
        <div className="small text-muted mt-2" style={{ fontSize: '0.78rem' }}>
          {t('multitrackConsentRequired')}
        </div>
      )}
    </div>
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
          <ChatPanel
            eventSlug={event.slug}
            token={chatToken}
            displayName={trimmedName}
            isGuest={!chatToken}
          />
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

  // Status banners (warm-up / JVB scaling). Only one is ever visible at a
  // time (warming-up implies not LIVE, JVB only LIVE). Rendered as plain
  // styled divs — NOT <Alert> — because Bootstrap Italia's .alert draws an
  // icon via ::before (reserved padding-left:4em) and the leading <Spinner>
  // would collide with it (see feedback_bootstrap-italia-alert). The div
  // owns its own spinner+border layout, like multitrackConsentBlock.
  const statusBanners = (
    <>
      {isLive && jvbReady === false && (
        <div
          className="rounded-3 p-3 text-start"
          style={{ background: '#FFF8E6', border: '1px solid #E0C97A', fontSize: '0.85rem' }}
          role="status"
        >
          <div className="d-flex align-items-start">
            <Spinner active small className="me-2 mt-1 flex-shrink-0" />
            <div>
              <strong>{t('jvbScaling')}</strong>
              <br />
              {t('jvbScalingDetail')}
            </div>
          </div>
        </div>
      )}
      {isWarmingUp && (
        <div
          className="rounded-3 p-3 text-start"
          style={{ background: '#E7F1FB', border: '1px solid #9EC5E9', fontSize: '0.85rem' }}
          role="status"
          aria-live="polite"
        >
          <div className="d-flex align-items-start">
            <Spinner active small className="me-2 mt-1 flex-shrink-0" />
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2">
                <strong>
                  {warmup?.phase === 'ready'
                    ? t('warmup.almostReady')
                    : warmup?.phase === 'starting'
                      ? (warmupElapsed ?? 0) >= 75
                        ? t('warmup.provisioningNode')
                        : t('warmup.startingBridge')
                      : t('warmup.queued')}
                </strong>
                {warmupElapsed !== null && warmupElapsed > 0 && (
                  // aria-hidden: la banda è una live region (role=status +
                  // aria-live), ma il cronometro cambia ogni secondo — senza
                  // questo lo screen reader ri-annuncerebbe la banda a ogni
                  // tick. Restano annunciati solo fase e dettaglio (rari).
                  <span
                    className="font-monospace"
                    style={{ fontSize: '0.8rem', color: 'var(--app-muted)' }}
                    aria-hidden="true"
                  >
                    {t('warmup.elapsed', {
                      time: `${Math.floor(warmupElapsed / 60)}:${String(warmupElapsed % 60).padStart(2, '0')}`,
                    })}
                  </span>
                )}
              </div>
              <div className="mt-1">
                {warmup?.phase === 'ready'
                  ? t('warmup.almostReadyDetail')
                  : t('warmup.honestHint')}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Primary CTA (non-ended): start (moderator) / enter live / warming-up /
  // scheduled-opening disabled state, plus optional catch-up.
  const liveCueActive = canEnterLive && liveCountdown !== null;
  const primaryCta = (
    <div className="d-grid gap-2">
      {startError && (
        <Alert color="danger" className="mb-0" style={{ fontSize: '0.85rem' }}>
          {startError}
        </Alert>
      )}
      {liveCueActive && (
        <div
          className="text-center rounded-3 p-2"
          role="status"
          aria-live="assertive"
          style={{ background: 'linear-gradient(135deg, #008758, #00592f)', color: '#fff' }}
        >
          <div className="small text-uppercase fw-semibold opacity-75">
            {t('roomOpen')}
          </div>
          <div className="display-6 fw-bold font-monospace lh-1">{liveCountdown}</div>
        </div>
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
      {/* Uscita esplicita: nella sala d'attesa non si è "intrappolati" —
          soprattutto durante il warm-up, quando la CTA è disabilitata. Non
          in PUBLISHED: lì c'è già il backLinkBlock ("Indietro") più in basso,
          verso la stessa pagina evento — evitiamo il doppione. */}
      {exitHref && !isEnded && !isPublished && (
        <Link
          href={exitHref}
          className="btn btn-outline-secondary btn-sm mt-1"
          style={{ justifySelf: 'center' }}
        >
          {t('exitWaiting')}
        </Link>
      )}
    </div>
  );

  // ── Unified DSI shell (default for every state) ──
  // The controls are the focus (main column); the interactive garden/lobby +
  // chat live in a delimited "Mentre aspetti" box — a secondary "di cui", not
  // the fulcro. The game box is hidden for ENDED, when multitrack consent is
  // required (hard-gate), and in the accessibility "classic" view (the default
  // on touch devices — see the engine-resolution effect above).
  // C1 — la sala d'attesa è una PAGINA (evento, controlli, contatti), e il
  // gioco è un posto in cui si sceglie di entrare.
  //
  // Prima c'erano due giochi: un giardino SVG minimale incastrato nel riquadro
  // laterale e, opzionalmente, la lobby Phaser — anch'essa in quel riquadro. Il
  // primo è stato rimosso (era troppo piccolo per essere un gioco e troppo
  // ingombrante per essere un ornamento) e la seconda ha smesso di stare in una
  // scatola: si apre a piena pagina, con dentro tutto il necessario — nome,
  // controlli, ingresso in call — e un'uscita che riporta qui.
  const canPlay = !isEnded && !classicView && !multitrackRequired;

  // Modalità piazza a piena pagina. Il gioco prende la scena; i controlli
  // restano quelli DI QUESTA PAGINA, in un pannello a fianco — è il "collegali"
  // chiesto: stesso nome, stesse preferenze audio/video, stessa CTA validata,
  // stessa chat, stesse informazioni sull'evento. Un solo insieme di controlli,
  // in una sola lingua, validato una sola volta.
  //
  // `hostOwnsEntry` spegne la chrome interna della lobby (onboarding, top bar,
  // pannello dispositivi). Senza, il gioco ne mostra una propria: in italiano
  // fisso — su 24 lingue —, con un nome che non torna mai nello stato React
  // (quindi l'ingresso si blocca in silenzio) e un ingresso che scavalca il
  // gate LIVE, facendo entrare un moderatore in una sala mai avviata.
  const gameFullScreen = canPlay && gameOpen ? (
    <PhaserLobbyBoundary onError={() => { setGameOpen(false); toggleClassic(true); }}>
      <div
        className="wr-game-full"
        role="dialog"
        aria-modal="true"
        aria-label={t('gardenDialogLabel')}
        ref={gameDialogRef}
      >
        <div className="wr-game-full__stage">
          <PhaserLobby
            hostOwnsEntry
            eventSlug={event.slug}
            displayName={trimmedName}
            status={event.status}
            startsAtMs={startsAtMs}
            isHost={isModerator}
            onEnterLive={handleGameEnter}
            // "Versione classica" dentro il gioco è l'uscita di sicurezza per
            // chi non regge l'animazione: deve RICORDARE la scelta, non solo
            // chiudere l'overlay e riproporre la piazza al reload successivo.
            onExitClassic={() => { setGameOpen(false); toggleClassic(true); }}
          />
          <button
            type="button"
            className="wr-game-full__exit"
            onClick={() => setGameOpen(false)}
          >
            <Icon icon="it-arrow-left" size="xs" className="me-1" />
            {t('backToWaitingRoom')}
          </button>
        </div>
        <aside className="wr-game-full__panel">
          <div className="wr-game-full__panel-inner">
            <EventTitle
              title={event.title}
              kickerEnabled={event.parseTitleKicker ?? false}
              as="h2"
              className="h6 fw-bold mb-1"
              style={{ color: 'var(--app-text)' }}
            />
            <div className="text-muted mb-3" style={{ fontSize: '0.8rem' }}>
              {dateLabel} · {startTimeLabel} – {endTimeLabel}
            </div>
            {statusBanners}
            <div className="d-grid gap-3">
              {nameField}
              {deviceCheckField}
              {primaryCta}
              {isLive && (
                <p className="text-muted mb-0" style={{ fontSize: '0.78rem' }}>
                  {t('gardenGateHint')}
                </p>
              )}
              {chatPreviewBlock}
            </div>
          </div>
        </aside>
      </div>
    </PhaserLobbyBoundary>
  ) : null;

  // Il riquadro laterale ora ospita solo la chat: aspettare insieme agli altri
  // non era la parte che stava in mezzo.
  const asideBox = chatPreviewBlock ? (
    <Card className="wr-aside shadow-sm border-0">
      <div className="wr-aside__head">
        <span className="fw-semibold">{t('whileYouWait')}</span>
      </div>
      <div className="wr-aside__body">{chatPreviewBlock}</div>
    </Card>
  ) : null;

  // L'invito al gioco: un riquadro nella colonna principale, sotto i controlli.
  // È il "pulsante o infografica" chiesto — un gesto esplicito, non una scena
  // che parte addosso a chi è arrivato per prepararsi.
  const gameInvite = canPlay && !gameOpen ? (
    <button
      type="button"
      className="wr-game-invite"
      onClick={() => setGameOpen(true)}
    >
      <span className="wr-game-invite__art" aria-hidden="true">🌿</span>
      <span>
        <span className="wr-game-invite__title">{t('enterGardenTitle')}</span>
        <span className="wr-game-invite__hint">{t('enterGardenHint')}</span>
      </span>
    </button>
  ) : null;

  // Il gioco prende tutta la pagina: dentro ha nome, controlli e ingresso in
  // call, e l'uscita riporta esattamente qui.
  if (gameFullScreen) return gameFullScreen;

  return (
    <div className="waiting-shell">
      <div className="container py-4 py-md-5">
        <div className="row g-4 justify-content-center">
          <div className={asideBox ? 'col-lg-7 col-xl-6' : 'col-lg-8 col-xl-7'}>
            <Card className="waiting-card shadow-sm border-0 overflow-hidden" style={{ borderRadius: 16 }}>
              <div
                className="waiting-hero"
                style={{
                  height: 160,
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

                {/* "Sta per iniziare, attendi l'organizzatore": non al moderatore —
                    l'organizzatore è lui, e ha accanto il bottone "Avvia evento". */}
                {isPublished && startingSoon && !isModerator && (
                  <div
                    className="rounded-3 p-3 mb-4 text-center d-flex align-items-center justify-content-center"
                    role="status"
                    aria-live="polite"
                    style={{ background: 'var(--app-emphasis-bg, #eef4fb)', color: 'var(--app-text)' }}
                  >
                    <Spinner active small className="me-2" />
                    <span className="fw-semibold">{t('startingSoon')}</span>
                  </div>
                )}

                {(isWarmingUp || (isLive && jvbReady === false)) && (
                  <div className="mb-4">{statusBanners}</div>
                )}

                {!isEnded && <div className="mb-3">{nameField}</div>}
                {/* Email: solo per gli ospiti (i registrati l'hanno già data,
                    per moderatori/speaker è irrilevante). Il valore non è ancora
                    inviato al server: campo di cortesia locale finché non c'è un
                    consumer reale del follow-up. */}
                {!isEnded && isGuest && (
                  <div className="mb-3">{emailField}</div>
                )}
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
                  <>
                    {multitrackConsentBlock && (
                      <div className="mb-3">{multitrackConsentBlock}</div>
                    )}
                    <div className="mb-3">{primaryCta}</div>
                  </>
                )}

                {event.tempRecordingUrl && !isEnded && (
                  <p className="text-muted mb-3 text-center" style={{ fontSize: '0.8rem' }}>
                    {t('watchCatchupDesc')}
                  </p>
                )}

                {/* Re-show the game box after it was hidden (accessibility /
                    touch default). Only when the game is actually available. */}
                {!isEnded && !multitrackRequired && classicView && (
                  <div className="text-center mb-3">
                    <Button color="primary" outline size="sm" className="fw-semibold" onClick={() => toggleClassic(false)}>
                      <Icon icon="it-arrow-left" size="xs" className="me-1" />
                      {t('backToGarden')}
                    </Button>
                  </div>
                )}

                {gameInvite && <div className="mb-3">{gameInvite}</div>}
                <div className="mb-3">{netiquetteBlock}</div>
                {recordingNoticeBlock && <div className="mb-3">{recordingNoticeBlock}</div>}
                {aiNoticeBlock && <div className="mb-3">{aiNoticeBlock}</div>}
                {backLinkBlock && <div className="text-center">{backLinkBlock}</div>}

                {isPublished && !isModerator && (
                  <p className="text-center text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
                    <Icon icon="it-refresh" size="xs" className="me-1" />
                    {t('autoRefreshHint')}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>

          {asideBox && <div className="col-lg-5 col-xl-5">{asideBox}</div>}
        </div>
      </div>
    </div>
  );
}
