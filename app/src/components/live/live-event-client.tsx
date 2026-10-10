'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { createPortal, preconnect } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Spinner,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link, useRouter, percorso } from '@/i18n/navigation';
import type { JitsiMeetExternalAPI } from '@/types/jitsi';
import type { VideoQualityPreset } from '@/lib/jitsi/config';
import {
  faseRegistratoreStabile,
  leggiFaseRegistratore,
  leggiStatoPonte,
  leggiStatoRegistratore,
  type FaseRegistratore,
} from '@/lib/jitsi/bridge-readiness';
import JitsiRoom from '@/components/jitsi/jitsi-room';
import { LivePushContext, useLivePush, useLiveState } from '@/hooks/use-live-state';
import { useQaAlerts } from '@/hooks/use-qa-alerts';
import {
  consensoRegistrazioneIngresso,
  consensiDaInviare,
  type ProveConsenso,
} from '@/lib/live/entry-consents';
import QAPanel from '@/components/qa/qa-panel';
import PollPanel from '@/components/polls/poll-panel';
import AgendaPanel from '@/components/live/agenda-panel';
import MaterialPanel from '@/components/materials/material-panel';
import { fetchMaterials, materialsListKey } from '@/components/materials/material-request';
import ParticipantPanel from '@/components/participants/participant-panel';
import PostEventFeedback from '@/components/live/post-event-feedback';
import PresentationTimerBar from '@/components/live/presentation-timer';
import LiveTimeStrip from '@/components/live/live-time-strip';
import ClosingNotice from '@/components/live/closing-notice';
import LiveCaptions from '@/components/live/live-captions';
import StageName from '@/components/live/stage-name';
import ControlRoomPanel, { type FunzioneSala } from '@/components/live/control-room-panel';
import { useCaptionsControl } from '@/hooks/use-captions-control';
import { useRecordingControl, type ControlloRegistrazione } from '@/hooks/use-recording-control';
import { primaryLanguageCode } from '@/lib/captions/vocabulary';
import { TimerInterventiSync, useScartoOrologio } from '@/hooks/use-presentation-timer';
import { usePresenze } from '@/hooks/use-presence';
import ReactionBar from '@/components/live/reaction-bar';
import ChatPanel, { type ChatPreview } from '@/components/live/chat-panel';
import WordCloud from '@/components/live/word-cloud';
import {
  registrationAccessToken,
  voterIdentity,
  voterIdStorageKey,
} from '@/components/live/voter-identity';
import AgendaTicker from '@/components/live/agenda-ticker';
import LiveShareButton from '@/components/live/live-share-button';
import WaitingRoom, {
  type RiepilogoSala,
  type WaitingRoomJoinPrefs,
  type WaitingRoomWarmup,
} from '@/components/live/waiting-room';
import { closingPhase, exitDestination, phaseAfterTokenConflict } from '@/components/live/live-phase';
import { warmupFromLifecycle } from '@/components/live/lifecycle-warmup';
import { avatarColor, avatarInitials } from '@/lib/chat/avatar';
import { isHumanParticipant } from '@/lib/jitsi/participants';
import { splitTitleKicker } from '@/lib/utils/title-kicker';
import { useSettings } from '@/lib/settings-context';
import { OVERTIME_CAP_DEFAULT_MINUTES } from '@/lib/events/overtime-defaults';

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
  /** L'evento ammette chi entra senza token (lib/events/guest-window). Falso
   *  solo per un evento in calendario con l'accesso ospiti spento: il link
   *  «per partecipare» porterebbe all'iscrizione e non va offerto. */
  guestEntryOpen?: boolean;
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
  /** Descrizione, enti e persone per il riepilogo della sala d'attesa. */
  riepilogo?: RiepilogoSala;
  imageUrl?: string | null;
  coverImageUrl?: string | null;
  maxParticipants?: number;
  registrationCount?: number;
  /** Soft-exit grace in minutes past endsAt. Null → site default. */
  gracePeriodMinutes?: number | null;
  /** Tetto del fuori orario risolto (default di sito applicato): lo usa il contatore. */
  effectiveGraceMinutes?: number;
  tempRecordingUrl?: string | null;
  recordingUrl?: string | null;
  /** Admin-configured post-event visibility — used to seed the end-of-call
   *  "Destino evento" default so ending the call never silently overrides a
   *  pre-configured private (postEventPublic=false) or library setting. */
  postEventPublic?: boolean;
  libraryListed?: boolean;
  feedbackEnabled?: boolean;
  /** Testo di consenso alla registrazione scelto per l'evento; null = quello predefinito. */
  recordingConsentText?: string | null;
  /** L'informativa privacy dell'evento (lib/events/privacy-notice), accanto
   *  al consenso chiesto in sala d'attesa. */
  privacy?: { url: string; testo?: string };
  timezone?: string;
  /** True quando il master switch AI è attivo e l'evento usa almeno una
   *  feature di post-produzione AI — abilita l'informativa in sala d'attesa. */
  aiPostprodEnabled?: boolean;
  /** Testo custom per-locale dell'informativa AI (SiteSetting); null →
   *  la WaitingRoom usa il fallback i18n. */
  aiConsentDisclosure?: string | null;
  /** Sottotitoli live disponibili nell'istanza: accesi dall'amministrazione e
   *  servizio installato (lib/captions/availability). */
  liveCaptionsAvailable?: boolean;
  /** Il flag dell'evento all'apertura della pagina; dal vivo vale quello dei
   *  flag della sala, che chi modera può cambiare. */
  liveCaptionsEnabled?: boolean;
  /** La lingua predefinita dell'istanza, la stessa con cui il servizio trascrive. */
  liveCaptionsLanguage?: string;
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
  /** Lo stesso per il consenso alla registrazione dell'evento: dato
   *  all'iscrizione, o in sala d'attesa a un ingresso precedente. */
  hasRecordingConsent?: boolean;
  displayName: string;
  locale: string;
  jitsiDomain: string;
  watermark?: WatermarkSettings;
  /** L'installazione puo' registrare (lib/recording/availability), risolto dal
   *  Server Component. Senza, l'avviso «questo evento viene registrato» e il
   *  consenso prima di entrare non si mostrano: prometterebbero una
   *  registrazione che nulla puo' fare. Default true: nel dubbio il consenso
   *  si chiede. */
  recordingAvailable?: boolean;
  /** Reactions mode (admin SiteSetting): 'NATIVE' = Jitsi's own reactions
   *  button (ephemeral); 'CUSTOM' = the app's analytics-backed ReactionBar.
   *  Default 'NATIVE'. */
  reactionsMode?: 'NATIVE' | 'CUSTOM';
  /** rnnoise (soppressione rumore avanzata di Jitsi) forzata OFF.
   *  Default true = spenta, che è il comportamento da validare in una call
   *  vera prima di cambiarlo. Risolto a RUNTIME dal Server Component (vedi
   *  lib/jitsi/rnnoise.ts): qui non si può leggere l'env, perché in un
   *  componente client webpack lo congela nel bundle a build time. */
  rnnoiseEnforceOff?: boolean;
  /** L'installazione ha il backend della lavagna (Excalidraw) e
   *  `config.whiteboard.enabled` lato Jitsi. Senza, il pulsante nella barra di
   *  Jitsi, quello del moderatore e il promemoria di esportazione restano
   *  nascosti — insieme, anche per le chiamate istantanee. Risolto a
   *  RUNTIME dal Server Component (lib/jitsi/whiteboard.ts), per lo stesso
   *  motivo di `rnnoiseEnforceOff`. Default false. */
  whiteboardInfraReady?: boolean;
}

type LivePhase =
  | 'waiting'
  | 'fetching_jwt'
  | 'ready'
  | 'reconnecting'
  // Uscito dalla conferenza con l'evento ancora aperto: si puo' rientrare.
  | 'left'
  | 'ended'
  | 'error';

/** Quanto resta a schermo l'anteprima di un messaggio arrivato a chat chiusa. */
const CHAT_PREVIEW_MS = 6_000;
/** Una menzione resta di piu': e' un messaggio per chi guarda. */
const CHAT_MENTION_PREVIEW_MS = 12_000;

/** Larghezza della colonna dei pannelli su schermo largo: predefinita e limiti.
 *  Il massimo lascia sempre almeno 420 px alla videochiamata. */
const SIDEBAR_DEFAULT_W = 400;
const SIDEBAR_MIN_W = 320;
const SIDEBAR_MAX_W = 960;
const SIDEBAR_MIN_VIDEO_W = 420;
const SIDEBAR_WIDTH_KEY = 'pa-webinar.sidebar-width';
/** La colonna compressa a una striscia di icone, ricordata nel browser. */
const SIDEBAR_COLLAPSED_KEY = 'pa-webinar.sidebar-collapsed';

function clampSidebarWidth(w: number): number {
  const max = typeof window === 'undefined'
    ? SIDEBAR_MAX_W
    : Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, window.innerWidth - SIDEBAR_MIN_VIDEO_W));
  return Math.round(Math.min(max, Math.max(SIDEBAR_MIN_W, w)));
}

// Maximum number of automatic rejoin attempts after a network-induced
// `videoConferenceLeft`. After this many failures we fall through to the
// closing screen ("Sei uscito dalla sala", with a way back in, unless the
// event ended) so the user can decide what to do manually.
const MAX_RECONNECT_ATTEMPTS = 3;

// Grace window after an UNFLAGGED `videoConferenceLeft` before we commit to
// reconnecting. Jitsi's native hangup fires videoConferenceLeft first and
// `readyToClose` a moment later; this window lets the intentional-close
// signal veto the reconnect so clicking hangup doesn't bounce the user back
// into the call. A genuine drop (no readyToClose) just reconnects 1.2s later.
const LEAVE_RECONNECT_GRACE_MS = 1200;

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
  /** Le prove di consenso che il server ha salvato per questo posto. */
  consentsRecorded?: { recording: boolean; multitrack: boolean };
}

export default function LiveEventClient({
  event,
  token,
  isModerator,
  isPrimaryModerator = false,
  isSpeaker = false,
  isGuest = false,
  hasMultitrackConsent = false,
  hasRecordingConsent = false,
  displayName: initialDisplayName,
  locale,
  jitsiDomain,
  watermark,
  recordingAvailable = true,
  reactionsMode = 'NATIVE',
  rnnoiseEnforceOff = true,
  whiteboardInfraReady = false,
}: LiveEventClientProps) {
  const t = useTranslations('live');
  const tc = useTranslations('common');
  const tf = useTranslations('feedback');
  const router = useRouter();

  // Un solo canale per sala, montato qui: i pannelli si smontano al cambio
  // scheda e legarcelo aprirebbe e chiuderebbe una connessione a ogni click.
  // La chiusura dell'evento continua a rilevarla il controllo periodico su
  // `/lifecycle` (una query, ogni cinque secondi): reagire qui vorrebbe dire
  // duplicare la chiusura della sala, che tocca schermata di feedback e
  // segnali di riaggancio. Il canale la annuncia comunque, per chi vorra'
  // agganciarla in un secondo momento.
  const { pushLive } = useLiveState(event.slug);
  const [phase, setPhase] = useState<LivePhase>('waiting');
  const [credentials, setCredentials] = useState<JitsiCredentials | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  // Mirror of participantCount for the peak reporter's interval: reading it
  // from a ref keeps the 30s timer from being torn down and restarted on every
  // join/leave (which would reset the cadence in a busy room).
  const participantCountRef = useRef(0);
  useEffect(() => { participantCountRef.current = participantCount; }, [participantCount]);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState('');
  const [jitsiApi, setJitsiApi] = useState<JitsiMeetExternalAPI | null>(null);
  // App-owned fullscreen: fullscreen the whole live wrapper (video +
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
  // Chi è in diretta e chi aspetta: la pagina lo segnala per tutta la visita,
  // spostandosi da «attesa» a «diretta» quando entra nella chiamata. Non a
  // evento concluso, né fuori dalla sala (uscita, errore, fine).
  const inChiamata = phase === 'ready' || phase === 'reconnecting';
  const presenze = usePresenze(
    event.slug,
    inChiamata ? 'diretta' : 'attesa',
    eventStatus !== 'ENDED' && phase !== 'ended' && phase !== 'error' && phase !== 'left',
    token || undefined,
  );
  // Letto dai gestori di uscita, che non devono ricrearsi a ogni cambio di
  // stato: decide fra «Evento concluso» e «Sei uscito dalla sala».
  const eventStatusRef = useRef(event.status);
  useEffect(() => {
    eventStatusRef.current = eventStatus;
  }, [eventStatus]);
  // La fine vera dell'evento: il ref si aggiorna subito, perche' un
  // `videoConferenceLeft` in arrivo non trovi ancora lo stato vecchio.
  const markEnded = useCallback(() => {
    eventStatusRef.current = 'ENDED';
    setEventStatus('ENDED');
  }, []);
  // Endpoint id di questo browser nella conferenza: il pannello partecipanti
  // non offre di espellere la propria riga.
  const [localEndpointId, setLocalEndpointId] = useState<string | null>(null);

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
  const [leftFeedbackOpen, setLeftFeedbackOpen] = useState(false);
  // La valutazione gia' data o saltata in questa visita: la schermata di
  // chiusura non la chiede una seconda volta.
  const [feedbackSettled, setFeedbackSettled] = useState(false);
  // Stable anonymous id for guests, persisted in localStorage so a refresh or
  // a network-induced Jitsi reconnect keeps the same identity (poll/agenda
  // dedup + "my reaction" recall depend on it). SSR-safe: falls back to a
  // fresh in-memory id when window/localStorage is unavailable.
  // Identità con cui si vota e si reagisce. Chi si è iscritto ha un
  // `accessToken` di registrazione; ospiti, relatori e moderatori non ce
  // l'hanno e usano l'identificativo stabile del browser qui sotto. Il token
  // moderatore NON è un'identità di voto: il server lo cerca fra le
  // registrazioni e risponde 403. La regola sta in voter-identity.
  const registeredAccessToken = registrationAccessToken({
    token,
    isGuest,
    isModerator,
    isSpeaker,
  });
  const [guestId] = useState(() => {
    if (registeredAccessToken) return '';
    const fresh = () => `guest_${Math.random().toString(36).slice(2, 10)}`;
    if (typeof window === 'undefined') return fresh();
    try {
      // Una chiave per ruolo: l'anteprima da ospite aperta da chi conduce
      // nello stesso browser non eredita i suoi voti (voter-identity).
      const k = voterIdStorageKey({ isModerator, isSpeaker });
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
  // Cosa mostrare sul pulsante di registrazione di chi modera: «in avvio»
  // solo finché la sonda lo dice, poi «non partito» (vedi bridge-readiness).
  const [recorderPhase, setRecorderPhase] = useState<FaseRegistratore | null>(null);
  // Telemetria warm-up dal poll /lifecycle (solo mentre IDLE/PROVISIONING):
  // alimenta il pannello di attesa onesto della WaitingRoom.
  const [warmup, setWarmup] = useState<WaitingRoomWarmup | null>(null);
  // Pre-join camera/mic choice captured by the waiting room's DeviceCheck.
  // Forwarded to JitsiRoom as `startWithVideoMuted`/`startWithAudioMuted`
  // so the user actually lands in the room with the state they picked.
  // Fotocamera e microfono partono spenti per tutti: li accende in sala
  // d'attesa chi vuole provarli, e la scelta si ricorda a parte per chi
  // conduce o interviene (anche nelle chiamate istantanee, riunioni fra pari)
  // e per chi assiste.
  const conduceOInterviene = isModerator || isSpeaker || event.eventType === 'INSTANT';
  // I consensi dati in sala d'attesa di cui il server ha salvato la prova, in
  // questa visita della pagina: a un ritorno in sala (evento tornato in
  // attesa, uscita e rientro) non si chiedono di nuovo, e ogni ingresso
  // successivo ne porta la prova per il suo posto (lib/live/entry-consents).
  // Contano solo se il server dice di averli salvati: se l'ingresso fallisce,
  // o la scrittura non riesce, la casella torna.
  const [consensiRegistrati, setConsensiRegistrati] = useState<ProveConsenso>({
    registrazione: false,
    tracce: false,
  });
  // La registrazione dell'evento, per chi entra dalla sala d'attesa: se
  // chiederne il consenso, o se basta informare.
  const consensoRegistrazione = consensoRegistrazioneIngresso({
    formato: {
      recordingEnabled: event.recordingEnabled,
      multitrackRecordingEnabled: event.multitrackRecordingEnabled ?? false,
      participantsCanUnmute: event.participantsCanUnmute,
      participantsCanStartVideo: event.participantsCanStartVideo,
      participantsCanShareScreen: event.participantsCanShareScreen,
    },
    registrazioneDisponibile: recordingAvailable,
    conduce: isModerator || isSpeaker,
    giaDato: hasRecordingConsent || consensiRegistrati.registrazione,
  });
  const [joinPrefs, setJoinPrefs] = useState<WaitingRoomJoinPrefs>({
    cameraOn: false,
    micOn: false,
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

  // Poll infrastructure status (JVB + Jibri) when event is LIVE.
  // Dentro la chiamata lo stato del ponte non serve piu' (decide la sala
  // d'attesa e la copertura prima dell'ingresso): da li' continua a chiederlo
  // solo chi modera, per lo stato del registratore. Con centinaia di persone in
  // sala erano centinaia di richieste ogni 3 secondi per tutta la diretta.
  const statusPollNeeded = !jitsiJoined || isModerator;
  useEffect(() => {
    if (eventStatus !== 'LIVE') {
      setJvbReady(null);
      setJibriReady(null);
      setRecorderPhase(null);
      return;
    }
    if (!statusPollNeeded) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/status');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          // Vedi lib/jitsi/bridge-readiness: `false` vuol dire «si sta
          // accendendo adesso», e nient'altro.
          setJvbReady(leggiStatoPonte(data.metrics));
          setJibriReady(leggiStatoRegistratore(data.metrics?.jibriStatus));
          setRecorderPhase((mostrata) =>
            faseRegistratoreStabile(mostrata, leggiFaseRegistratore(data.metrics?.jibriStatus)),
          );
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
  }, [eventStatus, statusPollNeeded]);

  // Determine initial phase. Everyone (guest, participant, moderator,
  // speaker) lands on the unified waiting room first regardless of
  // status (PUBLISHED / LIVE / ENDED) — the waiting room itself shows
  // the right content (countdown / join CTA / recording + feedback).
  // `phase='ended'` is now only reached mid-session when the event really
  // ends, for the "evento concluso" thank-you screen; `phase='left'` when
  // this client leaves a call that is still open.
  // We also preserve `reconnecting` and `fetching_jwt` so a network blip
  // mid-event doesn't get clobbered back to the waiting room when the
  // LIVE→LIVE eventStatus poll re-fires this effect.
  useEffect(() => {
    setPhase((prev) =>
      prev === 'ready' ||
      prev === 'ended' ||
      prev === 'left' ||
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
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${event.slug}/lifecycle`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
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
        // Tutte le fasi, 'scheduled' compresa (nessuno scaler: la sala si
        // apre all'orario d'inizio); una fase sconosciuta diventa null.
        setWarmup(warmupFromLifecycle(data));
      } catch {
        /* retry */
      }
    };
    // Subito, non dopo il primo intervallo: senza scaler la fase 'scheduled'
    // sostituisce la stima di accensione, e tre secondi di «in coda» prima
    // dell'orologio racconterebbero un'accensione che non c'è.
    void poll();
    const pollInterval = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [phase, event.slug, eventStatus]);

  // Fetch JWT. Shape of the request depends on the caller:
  //   - moderator / speaker magic-link:  moderatorToken=<token>
  //   - registered participant:          accessToken=<token>
  //   - anonymous guest (no token):      guestName=<name>
  const fetchJwt = useCallback(async () => {
    setError('');
    try {
      const body: Record<string, string | boolean> = {};
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
      // I consensi dati in sala d'attesa (alla registrazione dell'evento, alla
      // traccia per partecipante): il server ne conserva la prova insieme al
      // posto nella conferenza, uno nuovo a ogni ingresso.
      const prove = consensiDaInviare(joinPrefs, consensiRegistrati);
      if (prove.registrazione) body.recordingConsent = true;
      if (prove.tracce) body.multitrackConsent = true;
      if (prove.registrazione || prove.tracce) body.locale = locale;

      const res = await fetch(`/api/events/${event.slug}/jitsi/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        // Il cookie della password e' scaduto mentre si era in sala: la
        // pagina della password lo rilascia, riprovare qui non servirebbe.
        if (data.code === 'JOIN_PASSWORD_REQUIRED') {
          router.replace(percorso(`/events/${event.slug}/password`));
          return;
        }
        // L'evento non ammette piu' ingressi (concluso, o tornato in attesa
        // dopo l'inattivita') mentre si rientrava o si aspettava: lo stato
        // vero lo dice /lifecycle, e la schermata giusta non e' un errore.
        if (res.status === 409) {
          try {
            const lc = await fetch(`/api/events/${event.slug}/lifecycle`);
            const lcData = lc.ok ? ((await lc.json()) as { status?: string }) : null;
            const next = phaseAfterTokenConflict(lcData?.status);
            if (next === 'ended') {
              markEnded();
              setPhase('ended');
              return;
            }
            if (next === 'waiting' && lcData?.status) {
              // Tornando in sala d'attesa la si lascia risvegliare il bridge.
              wokeOnceRef.current = false;
              eventStatusRef.current = lcData.status;
              setEventStatus(lcData.status);
              setPhase('waiting');
              return;
            }
          } catch {
            /* resta l'errore qui sotto */
          }
        }
        // L'amministrazione ha chiuso l'ingresso da ospite mentre si era in
        // sala d'attesa: il testo del server non e' tradotto, e «Riprova»
        // non cambierebbe l'esito.
        setError(
          data.code === 'GUEST_ACCESS_DISABLED'
            ? t('guestAccessDisabled')
            : (data.error ?? t('connectionError')),
        );
        setPhase('error');
        return;
      }

      const data: JitsiCredentials = await res.json();
      const salvati = data.consentsRecorded;
      if (salvati && (salvati.recording || salvati.multitrack)) {
        setConsensiRegistrati((c) => ({
          registrazione: c.registrazione || salvati.recording,
          tracce: c.tracce || salvati.multitrack,
        }));
      }
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
    router,
    t,
    markEnded,
    joinPrefs,
    consensiRegistrati,
    locale,
  ]);

  useEffect(() => {
    if (phase === 'fetching_jwt') {
      fetchJwt();
    }
  }, [phase, fetchJwt]);

  // Ingresso dalla sala d'attesa: nome, dispositivi e consensi li ha gia'
  // raccolti lei, quindi si chiede subito il JWT.
  const handleEnterFromWaiting = useCallback(
    (name: string, prefs: WaitingRoomJoinPrefs) => {
      setChosenName(name);
      setJoinPrefs(prefs);
      setPhase('fetching_jwt');
    },
    [],
  );

  // Poll event status during ready phase to detect ENDED
  useEffect(() => {
    if (phase !== 'ready') return;
    const pollInterval = setInterval(async () => {
      try {
        // Qui serve solo lo `status`, e questa chiamata la ripete ogni
        // partecipante ogni cinque secondi per tutta la durata dell'evento: la
        // rotta dell'evento intero carica anche relazioni che nessuno guarda.
        // `/lifecycle` è la stessa fonte, molto più leggera.
        const res = await fetch(`/api/events/${event.slug}/lifecycle`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === 'ENDED' && eventStatus !== 'ENDED') {
          markEnded();
          // Drive the in-app "Evento concluso" closing screen instead of
          // leaving phase='ready' (which keeps repainting the JVB warming
          // overlay over a dead iframe — "Sala in preparazione"). Mark this
          // as an intentional end so a late `videoConferenceLeft` from the
          // tearing-down iframe doesn't bounce the user into 'reconnecting'.
          userHangupRef.current = true;
          // La valutazione e' dentro la schermata di chiusura (phase 'ended').
          setPhase('ended');
        }
      } catch {
        /* retry */
      }
    }, 5000);
    return () => clearInterval(pollInterval);
  }, [phase, event.slug, eventStatus, isModerator, markEnded]);

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
    setPhase(closingPhase(eventStatusRef.current));
  }, []);

  // «Rientra» dalla schermata di uscita: di nuovo il token e la sala, come dopo
  // una riconnessione. Il consenso alla registrazione e' gia' stato dato.
  const handleRejoin = useCallback(() => {
    userHangupRef.current = false;
    reconnectAttemptsRef.current = 0;
    setCredentials(null);
    setJitsiJoined(false);
    setPhase('fetching_jwt');
  }, []);

  const handleFeedbackClose = useCallback(() => {
    // Closing the post-event feedback panel is also a legitimate end of
    // the session — flag it so a late `videoConferenceLeft` doesn't try
    // to rejoin a call the user has already left for good.
    userHangupRef.current = true;
    setShowFeedback(false);
    setFeedbackSettled(true);
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
  // La proposta di registrare non ha più senso quando la registrazione è
  // partita, da qui o da chiunque altro.
  useEffect(() => {
    if (isRecording) setShowRecPrompt(false);
  }, [isRecording]);
  const recPromptShownRef = useRef(false);
  const recPromptRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (recPromptRetryRef.current) clearTimeout(recPromptRetryRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (pendingLeaveTimerRef.current) clearTimeout(pendingLeaveTimerRef.current);
    };
  }, []);

  // Per la cronologia della sala: quando questo browser e' entrato nella
  // chiamata, l'ultimo stato della registrazione che ha visto, e se l'avvio
  // l'ha chiesto lui. Il primo avviso dopo l'ingresso dice com'era gia' la
  // registrazione, non che e' cambiata, a meno che a chiederla sia stato
  // proprio questo browser (avvio automatico, o «Avvia» appena entrati).
  const entratoAlleRef = useRef<number | null>(null);
  const registrazioneVistaRef = useRef<boolean | null>(null);
  const avvioChiestoQuiRef = useRef(false);
  // Quando questo browser ha visto partire la registrazione (un cambio vero,
  // non lo stato trovato entrando): fa da riferimento per la durata quando il
  // server non sa, o sa male, quando è iniziata.
  const [avvioOsservato, setAvvioOsservato] = useState<number | null>(null);
  // Quante volte questo browser è entrato nella chiamata: dopo una
  // riconnessione l'ora d'avvio si richiede, non si riusa quella in cache.
  const [ingressi, setIngressi] = useState(0);
  const scartoOrologio = useScartoOrologio(event.slug);

  // Shared "fire startRecording on Jitsi, with retry" — used both by the
  // moderator-confirmed prompt and by the autoStartRecording path which
  // bypasses the prompt entirely.
  const triggerRecording = useCallback((api: JitsiMeetExternalAPI) => {
    avvioChiestoQuiRef.current = true;
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
    entratoAlleRef.current = Date.now();
    registrazioneVistaRef.current = null;
    // Quello che si è visto prima di cadere non vale più: la registrazione
    // può essere stata fermata e riavviata nel frattempo.
    setAvvioOsservato(null);
    setIngressi((n) => n + 1);
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
    if (!showFeedback) setPhase(closingPhase(eventStatusRef.current));
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
    // feedback flow / ENDED poll): show the closing screen right away —
    // «Evento concluso» only if the event really ended, otherwise the
    // «you left» screen with a way back in.
    if (userHangupRef.current) {
      if (!showFeedback) setPhase(closingPhase(eventStatusRef.current));
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
        if (!showFeedback) setPhase(closingPhase(eventStatusRef.current));
        return;
      }
      // No intentional-close signal — ask the server whether the event
      // ended (→ closing screen) or it's a real drop (→ reconnect).
      void (async () => {
        try {
          const res = await fetch(`/api/events/${event.slug}/lifecycle`);
          // readyToClose may still land while the fetch is in flight.
          if (userHangupRef.current) {
            setPhase(closingPhase(eventStatusRef.current));
            return;
          }
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'ENDED') {
              markEnded();
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
            setPhase(closingPhase(eventStatusRef.current));
          }
        } catch {
          // Network error reaching our own API — most likely the user is
          // still offline. Treat as a transient drop and keep retrying
          // until we exhaust the attempt budget.
          if (userHangupRef.current) {
            setPhase(closingPhase(eventStatusRef.current));
            return;
          }
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current += 1;
            setPhase('reconnecting');
          } else {
            setPhase(closingPhase(eventStatusRef.current));
          }
        }
      })();
    }, LEAVE_RECONNECT_GRACE_MS);
  }, [showFeedback, event.slug, markEnded]);
  const handleParticipantCountChanged = useCallback((count: number) => {
    setParticipantCount(count);
  }, []);
  const handleRecordingStatusChanged = useCallback(
    (recording: boolean) => {
      setIsRecording(recording);
      // Avvio e arresto della registrazione il server non li vede passare:
      // li riferisce chi modera, per la cronologia della sala. Il server
      // scarta lo stesso cambio riferito da piu' moderatori.
      const prima = registrazioneVistaRef.current;
      registrazioneVistaRef.current = recording;
      if (prima === recording) return;
      // «Ferma» senza aver mai visto «accesa» non è un cambio: Jitsi manda lo
      // stato anche quando si accende o spegne la trascrizione dei
      // sottotitoli, con la registrazione mai partita.
      if (prima === null && !recording) return;
      // Il primo stato visto appena entrati e' com'era gia': non un cambio,
      // salvo che l'avvio l'abbia chiesto questo browser.
      const entrato = entratoAlleRef.current;
      const chiestoQui = recording && avvioChiestoQuiRef.current;
      if (recording) avvioChiestoQuiRef.current = false;
      // Trenta secondi: Jitsi può consegnare lo stato iniziale con ritardo, e
      // un avvio vero di un altro moderatore in quella finestra lo riferisce
      // il suo browser.
      if (prima === null && !chiestoQui && entrato !== null && Date.now() - entrato < 30_000) return;
      setAvvioOsservato(recording ? Date.now() : null);
      if (!isModerator || !token) return;
      void fetch(`/api/events/${event.slug}/live-actions`, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: recording ? 'recording.started' : 'recording.stopped',
          atEpochMs: Date.now(),
          sentAt: Date.now(),
        }),
      }).catch((err: unknown) => {
        console.warn('[live] cronologia: registrazione non riferita', err);
      });
    },
    [isModerator, token, event.slug],
  );
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
  // just a moderator. Previously this was gated on
  // `isModerator`, so a moderator-less session (or one the moderator left before
  // the first tick) never bumped `peakParticipants`, leaving post-event
  // analytics at 0. We re-report the human-filtered count (Recorder excluded,
  // same helper as the sidebar) once immediately + every 30s. The re-post is
  // deliberately UNCONDITIONAL (self-healing): a dropped write is recovered on
  // the next tick. The server bump is a single conditional UPDATE (peak < count)
  // so it's monotonic and race-safe even with many concurrent reporters; the
  // redundant writes are a light, bounded cost accepted for that robustness.
  //
  // The count comes from the SAME value JitsiRoom pushes to the UI
  // (`onParticipantCountChanged`), not a second local computation: JitsiRoom
  // knows the local endpoint id from `videoConferenceJoined` and so counts the
  // roster exactly, while a recount here could only fall back to name matching.
  // One number, one source — what the sidebar shows is what the peak records.
  //
  // Guests (no token) report too: the live page passes token="" to anyone
  // joining a public-link / INSTANT room, and gating on it meant that exactly
  // the moderator-less sessions this path exists for recorded nothing. The server accepts a
  // tokenless report only where nobody could hold a token (INSTANT room, or an
  // event with no registrations) — elsewhere it answers 401, and we then stop
  // rather than re-posting a request that will be refused for the whole event.
  //
  // Only while THIS client is in the conference: the API handle outlives the
  // call (it is never reset), so gating on it alone would keep a page left on
  // the closing screen posting every 30 s for as long as the tab stays open.
  // A 404 means the event is no longer LIVE — nothing more to record for this
  // session; a rejoin starts a fresh reporter.
  const inConference = phase === 'ready' && jitsiJoined;
  useEffect(() => {
    if (!jitsiApi || !inConference) return;
    let stopped = false;
    const report = () => {
      if (stopped) return;
      const count = participantCountRef.current;
      if (count > 0) {
        fetch(`/api/events/${event.slug}/analytics/peak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(token ? { count, token } : { count }),
        })
          .then((res) => {
            if (res.status === 401 || res.status === 403 || res.status === 404) stopped = true;
          })
          .catch(() => {});
      }
    };
    report();
    const interval = setInterval(report, 30000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [jitsiApi, inConference, event.slug, token]);

  // Receive a moderator "lower your hand" control signal and lower our OWN
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
      if (evt?.id) {
        myEndpointIdRef.current = evt.id;
        setLocalEndpointId(evt.id);
      }
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
      setPhase(closingPhase(eventStatusRef.current));
    }
  }, [jitsiApi]);

  // App-owned fullscreen toggle: targets the live root wrapper so both the
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

  // Reactstrap portals every Modal into <body> by default. Once the app owns
  // fullscreen on the live wrapper, <body> is OUTSIDE the fullscreen
  // subtree, so those modals never reach the top layer and are simply invisible:
  // in fullscreen the moderator's "Esci dalla sala" dialog and the other
  // modals looked like dead buttons, with no way out of the room. («Condividi»
  // is an inline popover inside the top bar and does not need this.) Rendering them inside the fullscreen element fixes it,
  // and outside fullscreen we keep the default (undefined = <body>) so nothing
  // else changes.
  const modalContainer = isFullscreen ? (liveRootRef.current ?? undefined) : undefined;

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

  // «Termina evento» dalla scheda Regia: stessa fine di «Termina per
  // tutti», segnata prima che l'hangup faccia arrivare `readyToClose`. Chi ha
  // il link principale passa poi alla gestione dell'evento: il timer sta qui,
  // nella sala, che resta montata mentre la Regia sparisce con la chiamata.
  const vaiAllaGestioneRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (vaiAllaGestioneRef.current) clearTimeout(vaiAllaGestioneRef.current);
    },
    [],
  );
  const handleEndedFromControls = useCallback(() => {
    userHangupRef.current = true;
    markEnded();
    if (isPrimaryModerator) {
      vaiAllaGestioneRef.current = setTimeout(() => {
        router.push(percorso(`/admin/events/${event.id}?token=${token}`));
      }, 2000);
    }
  }, [markEnded, isPrimaryModerator, router, event.id, token]);

  // I comandi della registrazione e il timer degli interventi, montati una
  // volta: la striscia del tempo, la scheda Regia e la fascia del timer per il
  // pubblico leggono lo stesso stato.
  const conduce = credentials?.role === 'moderator';
  const segnaAvvioChiesto = useCallback(() => {
    avvioChiestoQuiRef.current = true;
  }, []);
  const registrazione = useRecordingControl({
    api: jitsiApi,
    attivo: conduce && event.recordingEnabled,
    isRecording,
    faseRegistratore: recorderPhase,
    onAvvioRichiesto: segnaAvvioChiesto,
  });
  // Sottotitoli live (ADR-018): il flag dell'evento, che chi modera cambia
  // dal vivo, arriva con gli altri flag della sala (canale push o polling,
  // stessa voce della barra laterale). Chi modera li accende nella stanza.
  const { data: flagsSala } = useSWR<{ liveCaptionsEnabled?: boolean }>(
    event.liveCaptionsAvailable ? `/api/events/${event.slug}/flags` : null,
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: pushLive ? 0 : 15000 },
  );
  const sottotitoliAccesi =
    !!event.liveCaptionsAvailable &&
    (flagsSala?.liveCaptionsEnabled ?? event.liveCaptionsEnabled ?? true);
  useCaptionsControl({
    api: jitsiApi,
    attivo: conduce && !!event.liveCaptionsAvailable,
    accesi: sottotitoliAccesi,
    // Solo un'etichetta per Jitsi: la lingua parlata la sceglie il servizio,
    // dalla lingua predefinita dell'istanza, e qui si usa la stessa.
    lingua: primaryLanguageCode(event.liveCaptionsLanguage),
  });
  // L'ora d'avvio della registrazione secondo il server (la cronologia della
  // sala), per un tempo uguale per tutti i moderatori, anche entrati dopo.
  // Si chiede finché la registrazione è in corso e il server non la sa. Una
  // chiave sua: la voce `/flags` la riscrive il canale live con i soli flag,
  // e l'ora d'avvio sparirebbe a ogni aggiornamento.
  const { data: flagsRegistrazione } = useSWR<{ recordingStartedAt?: string | null }>(
    // L'avvio osservato e l'ingresso nella chiave: dopo uno stop e un riavvio,
    // o dopo una riconnessione, non si riusa l'ora rimasta in cache.
    conduce && isRecording
      ? `/api/events/${event.slug}/flags?orologio=registrazione&dal=${avvioOsservato ?? 'entrata'}&ingresso=${ingressi}`
      : null,
    (url: string) => fetch(url).then((r) => r.json()),
    // Senza un avvio noto si richiede ogni dieci secondi; con l'avvio, ogni
    // minuto, per accorgersi di un riavvio fatto da altri.
    { refreshInterval: (dati) => (dati?.recordingStartedAt ? 60_000 : 10_000) },
  );
  // Aprire una scheda della barra laterale da fuori (la striscia del tempo):
  // il contatore fa ripetere la stessa richiesta.
  const [richiestaScheda, setRichiestaScheda] = useState<{ tab: SidebarTab; n: number } | null>(null);
  const apriRegia = useCallback(() => {
    setRichiestaScheda((r) => ({ tab: 'regia', n: (r?.n ?? 0) + 1 }));
  }, []);

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
      markEnded();
      setShowLeaveChoice(false);
      setShowEndDestino(false);
      setEndingForAll(false);
      if (jitsiApi) jitsiApi.executeCommand('hangup');
      setPhase('ended');
    } catch {
      setEndingForAll(false);
      setEndForAllError(t('leaveChoice.endError'));
    }
  }, [event.id, token, jitsiApi, t, endDestino, endGenAi, markEnded]);

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
  // Chi risponde: l'iscrizione, se c'e'; altrimenti l'identificativo stabile
  // del browser (ospiti e relatori, che un'iscrizione non ce l'hanno). Chi
  // modera non valuta l'evento che conduce.
  const feedbackIdentity = registeredAccessToken
    ? { accessToken: registeredAccessToken }
    : { guestId };
  const askFeedback = !isModerator && event.feedbackEnabled !== false;
  const feedbackModal = showFeedback && askFeedback ? (
    <PostEventFeedback
      eventSlug={event.slug}
      {...feedbackIdentity}
      mode="dialog"
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
            // L'avviso «questo evento viene registrato» solo dove qualcosa puo'
            // registrare: vedi `recordingAvailable`.
            recordingEnabled: event.recordingEnabled && recordingAvailable,
            tempRecordingUrl: event.tempRecordingUrl,
            recordingUrl: event.recordingUrl,
            waitingRoomAudioUrl: event.waitingRoomAudioUrl,
            feedbackEnabled: event.feedbackEnabled,
            chatEnabled: event.chatEnabled,
            qaEnabled: event.qaEnabled,
            timezone: event.timezone,
            aiPostprodEnabled: event.aiPostprodEnabled,
            aiConsentDisclosure: event.aiConsentDisclosure,
            liveCaptions: !!event.liveCaptionsAvailable && (event.liveCaptionsEnabled ?? true),
            multitrackRecordingEnabled: event.multitrackRecordingEnabled,
            riepilogo: event.riepilogo,
          }}
          presenze={presenze}
          role={isModerator ? 'moderator' : isGuest ? 'guest' : 'participant'}
          conduce={conduceOInterviene}
          condivisione={{
            locale,
            // Il link da moderatore solo a chi modera (non ai relatori).
            moderatorToken: isModerator && !isSpeaker ? token : undefined,
            hasPublicPage: event.eventType !== 'INSTANT',
            hasCallLink: event.guestEntryOpen !== false,
          }}
          jvbReady={jvbReady}
          warmup={warmup}
          // Uscita esplicita dalla sala d'attesa: le instant call non hanno una
          // pagina evento pubblica (404), quindi tornano alla home.
          exitHref={exitDestination(event.eventType, event.slug)}
          chatToken={token}
          eventType={event.eventType === 'INSTANT' ? 'INSTANT' : 'SCHEDULED'}
          defaultName={chosenName || initialDisplayName}
          onEnterLive={handleEnterFromWaiting}
          onStartEvent={isModerator ? handleStartEvent : undefined}
          onLeaveFeedback={askFeedback ? () => setShowFeedback(true) : undefined}
          // Esente dal consenso multitrack in sala d'attesa: chi l'ha già
          // prestato alla registrazione, o il moderatore (è chi ha configurato
          // e controlla la registrazione). Gli speaker NO: non controllano la
          // registrazione e la loro traccia audio isolata è esattamente il dato
          // (quasi-biometrico, ADR-013) che il gate protegge — devono spuntare
          // il consenso come ogni altro partecipante.
          multitrackConsentExempt={isModerator || hasMultitrackConsent || consensiRegistrati.tracce}
          recordingConsentRequired={consensoRegistrazione.richiesto}
          recordingListenOnly={consensoRegistrazione.soloAscolto}
          recordingConsentText={event.recordingConsentText}
          privacy={event.privacy}
        />
        {feedbackModal}
      </>
    );
  }

  // Il ritorno dalle schermate di uscita. Il moderatore principale torna al
  // pannello dell'evento; co-moderatori, relatori e partecipanti alla pagina
  // evento (il pannello accetta solo il token primario), o alla home per una
  // chiamata istantanea, che una pagina evento non ce l'ha.
  const exitHref = exitDestination(event.eventType, event.slug);
  const backLink = isPrimaryModerator ? (
    <Link href={percorso(`/admin/events/${event.id}?token=${token}`)}>
      <Button color="primary" outline tag="span">
        {tc('back')}
      </Button>
    </Link>
  ) : (
    <Link href={percorso(exitHref)}>
      <Button color="primary" outline tag="span">
        {exitHref === '/' ? t('backToHome') : t('backToEvent')}
      </Button>
    </Link>
  );

  // Il titolo dell'evento sopra il messaggio d'uscita: chi ha piu' schede
  // aperte, o torna al computer dopo un po', deve capire di quale sala si parla.
  const exitEventTitle = splitTitleKicker(event.title, event.parseTitleKicker ?? false).main;

  // ── Ended ──
  if (phase === 'ended') {
    return (
      <div className="live-exit container">
        <div className="live-exit__card">
          <span className="live-exit__icon live-exit__icon--success" aria-hidden="true">
            <Icon icon="it-check-circle" size="lg" color="success" />
          </span>
          <p className="live-exit__event">{exitEventTitle}</p>
          <h1 className="h3 mb-2">{t('eventEnded')}</h1>
          <p className="live-exit__message">{t('eventEndedMessage')}</p>

          {/* La valutazione dentro la scheda: comunque sia finita la call
              (fine dall'orario, da chi modera, rete caduta a evento chiuso). */}
          {askFeedback && !feedbackSettled && (
            <PostEventFeedback eventSlug={event.slug} {...feedbackIdentity} mode="inline" />
          )}

          <div className="live-exit__actions">{backLink}</div>
        </div>
      </div>
    );
  }

  // ── Uscito, evento ancora aperto ──
  // «Esci dalla sala», «Esci solo tu» o una riconnessione abbandonata: l'evento
  // continua, e dire «terminato» avrebbe fatto credere a chi modera di averlo
  // chiuso — senza lo scaler nessuno lo chiuderebbe al posto suo.
  if (phase === 'left') {
    return (
      <div className="live-exit container">
        <div className="live-exit__card">
          <span className="live-exit__icon" aria-hidden="true">
            <Icon icon="it-logout" size="lg" color="primary" />
          </span>
          <p className="live-exit__event">{exitEventTitle}</p>
          <h1 className="h3 mb-2">{t('leftTitle')}</h1>
          <p className="live-exit__message">{t('leftMessage')}</p>
          {isModerator && (
            <p className="live-exit__note">
              {t('leftModeratorReminder', { action: t('leaveChoice.endForAll') })}
            </p>
          )}

          {/* Uscito prima della fine: la valutazione si offre, non si impone. */}
          {askFeedback &&
            (leftFeedbackOpen ? (
              <PostEventFeedback eventSlug={event.slug} {...feedbackIdentity} mode="inline" />
            ) : (
              <p className="live-exit__note">
                {tf('leftPrompt')}{' '}
                <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => setLeftFeedbackOpen(true)}>
                  {tf('leftCta')}
                </button>
              </p>
            ))}

          <div className="live-exit__actions">
            <Button color="primary" onClick={handleRejoin}>
              <Icon icon="it-video" size="sm" color="white" className="me-2" />
              {t('rejoin')}
            </Button>
            {backLink}
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="container py-5">
        <Alert color="danger">
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
          <Link href={percorso(exitHref)}>
            <Button color="secondary" outline tag="span">
              {exitHref === '/' ? t('backToHome') : t('backToEvent')}
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
  // Lavagna in sala: scelta dell'evento (le chiamate istantanee l'hanno
  // sempre) E backend presente nell'installazione. Senza backend nessuna
  // delle tre superfici la offre: pulsante della barra di Jitsi, pulsante del
  // moderatore e promemoria di esportazione.
  const whiteboardOn = whiteboardInfraReady && (event.whiteboardEnabled || isInstantCall);
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
    <LivePushContext.Provider value={pushLive}>
    <div ref={liveRootRef} className="d-flex flex-column live-page-bg">
      <LiveTopBar
        hasPublicPage={!isInstantCall}
        hasCallLink={event.guestEntryOpen !== false}
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
        <LiveTimeStrip
          startsAt={event.startsAt}
          endsAt={event.endsAt}
          graceMinutes={event.effectiveGraceMinutes ?? OVERTIME_CAP_DEFAULT_MINUTES}
          recordingEnabled={event.recordingEnabled}
          isRecording={isRecording}
          recordingStartedAt={flagsRegistrazione?.recordingStartedAt ?? null}
          scartoOrologio={scartoOrologio}
          avvioOsservato={avvioOsservato}
          istantanea={isInstantCall}
          faseRegistratore={recorderPhase}
          registrazione={registrazione}
          eventSlug={event.slug}
          onApriRegia={apriRegia}
        />
      )}

      {/* Proposta di avviare la registrazione, quando il registratore è pronto.
          Un avviso nella striscia di chi conduce, non una finestra: arriva da
          solo, anche minuti dopo l'ingresso, e una finestra modale prendeva il
          focus a chi stava parlando o scrivendo. */}
      {isActualModerator && showRecPrompt && !showJvbOverlay && (
        <div className="live-rec-prompt" role="status">
          <span>{t('recordingPromptBody')}</span>
          <span className="live-rec-prompt__actions">
            <Button color="primary" size="xs" onClick={handleRecPromptStart}>
              {t('recordingPromptStart')}
            </Button>
            <Button color="light" outline size="xs" onClick={handleRecPromptLater}>
              {t('recordingPromptLater')}
            </Button>
          </span>
        </div>
      )}

      {/* Chi non conduce non vede l'orologio: solo, negli ultimi minuti, che
          la sala sta per chiudersi da sola. */}
      {!isActualModerator && !showJvbOverlay && !isInstantCall && (
        <ClosingNotice
          startsAt={event.startsAt}
          endsAt={event.endsAt}
          graceMinutes={event.effectiveGraceMinutes ?? OVERTIME_CAP_DEFAULT_MINUTES}
          scartoOrologio={scartoOrologio}
        />
      )}
      {/* Il timer degli interventi si legge solo in sala. */}
      <TimerInterventiSync eventSlug={event.slug} />
      {/* La fascia del timer per chi non conduce: chi conduce lo ha nella
          striscia del tempo. */}
      {!showJvbOverlay && !isActualModerator && <PresentationTimerBar eventSlug={event.slug} />}

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
              // I relatori hanno AV pieno (ADR 3): i limiti dei partecipanti non
              // valgono per loro, anche se in sala non moderano.
              role={isActualModerator ? 'moderator' : 'participant'}
              participantsCanUnmute={event.participantsCanUnmute || isSpeaker}
              participantsCanStartVideo={event.participantsCanStartVideo || isSpeaker}
              participantsCanShareScreen={event.participantsCanShareScreen || isSpeaker}
              enableFileSharing={isInstantCall}
              whiteboardEnabled={whiteboardOn}
              whiteboardInfraReady={whiteboardInfraReady}
              videoQuality={event.videoQuality}
              reactionsMode={reactionsMode}
              liveCaptions={Boolean(event.liveCaptionsAvailable)}
              liveCaptionsOn={sottotitoliAccesi}
              rnnoiseEnforceOff={rnnoiseEnforceOff}
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
            {/* Sottotitoli e nome di chi è sul palco in un'unica colonna sopra
                la barra di Jitsi: impilati, non si coprono mai. Montata da
                subito e solo nascosta sotto l'avviso di avvio del bridge:
                deve ascoltare la sala già dall'ingresso, che è l'evento che
                fa sparire quell'avviso. */}
            <div className="live-stage-bottom" hidden={showJvbOverlay}>
              <LiveCaptions api={jitsiApi} active={sottotitoliAccesi} />
              <StageName api={jitsiApi} />
            </div>
            {/* Custom reactions bar only in CUSTOM mode; NATIVE mode uses
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
          liveCaptionsAvailable={!!event.liveCaptionsAvailable}
          liveCaptionsEnabled={event.liveCaptionsEnabled ?? true}
          whiteboardEnabled={whiteboardOn}
          whiteboardInfraReady={whiteboardInfraReady}
          jitsiApi={jitsiApi}
          localParticipantId={localEndpointId}
          displayName={credentials.displayName}
          roomCount={participantCount}
          canReactAgenda={!isModerator && !isSpeaker}
          guestId={isGuest ? guestId : undefined}
          {...voterIdentity(registeredAccessToken, guestId)}
          richiestaScheda={richiestaScheda}
          regia={
            isActualModerator
              ? {
                  onEnded: handleEndedFromControls,
                  modalContainer,
                  recordingEnabled: event.recordingEnabled,
                  isRecording,
                  faseRegistratore: recorderPhase,
                  registrazione,
                }
              : undefined
          }
        />
      </div>

      {/* Moderator leave prompt: leave for yourself vs end for everyone. */}
      <Modal
        isOpen={showLeaveChoice}
        toggle={() => !endingForAll && setShowLeaveChoice(false)}
        centered
        container={modalContainer}
      >
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => !endingForAll && setShowLeaveChoice(false)}>
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
        container={modalContainer}
      >
        <ModalHeader closeAriaLabel={tc('close')} toggle={() => !endingForAll && setShowEndDestino(false)}>
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
    </LivePushContext.Provider>
  );
}

// ── Sidebar with tabs ──

type SidebarTab =
  | 'regia'
  | 'qa'
  | 'chat'
  | 'polls'
  | 'wordcloud'
  | 'agenda'
  | 'materials'
  | 'participants';

interface LiveSidebarProps {
  eventSlug: string;
  /** Persone nella chiamata adesso, dallo stesso conteggio che la sala riceve
   *  da Jitsi: il pannello dei partecipanti lo aggiorna solo quando e' aperto. */
  roomCount?: number;
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
  /** Sottotitoli live disponibili nell'istanza: la Regia mostra l'interruttore. */
  liveCaptionsAvailable: boolean;
  /** Il flag dei sottotitoli all'apertura, finché non arrivano i flag dal vivo. */
  liveCaptionsEnabled: boolean;
  /** Whiteboard is enabled for this call → show the "not saved" reminder. */
  whiteboardEnabled: boolean;
  /** …and the installation actually serves it (see LiveEventClientProps). */
  whiteboardInfraReady: boolean;
  jitsiApi: JitsiMeetExternalAPI | null;
  /** Endpoint id di questo browser nella conferenza (vedi ParticipantPanel). */
  localParticipantId: string | null;
  displayName: string;
  /** Audience (guests + registered participants) may react to agenda items;
   *  presenters (moderators/speakers) only see the tallies. */
  canReactAgenda?: boolean;
  /** Stable guest id (anonymous) for agenda-reaction dedup; undefined for
   *  registered participants (identified by their accessToken). */
  guestId?: string;
  /** Identità di voto nei sondaggi, nella nuvola e nel Q&A: l'`accessToken` di
   *  una registrazione… */
  voterAccessToken?: string;
  /** …oppure l'identificativo stabile del browser, per chi una registrazione
   *  non ce l'ha (ospiti, relatori, moderatori). Esattamente uno dei due. */
  voterGuestId?: string;
  /** Una scheda da aprire chiesta da fuori (la striscia del tempo apre la
   *  Regia); il contatore fa ripetere la stessa richiesta. */
  richiestaScheda?: { tab: SidebarTab; n: number } | null;
  /** La scheda Regia, per chi conduce (non per i relatori). */
  regia?: {
    onEnded: () => void;
    modalContainer?: HTMLElement;
    recordingEnabled: boolean;
    isRecording: boolean;
    faseRegistratore: FaseRegistratore | null;
    registrazione: ControlloRegistrazione;
  };
}

function LiveSidebar({
  eventSlug,
  roomCount,
  eventId,
  token,
  isModerator,
  qaEnabled,
  chatEnabled,
  agendaEnabled,
  liveCaptionsAvailable,
  liveCaptionsEnabled,
  whiteboardEnabled,
  whiteboardInfraReady,
  jitsiApi,
  localParticipantId,
  displayName,
  canReactAgenda = false,
  guestId,
  voterAccessToken,
  voterGuestId,
  richiestaScheda,
  regia,
}: LiveSidebarProps) {
  const tCommon = useTranslations('common');
  const t = useTranslations('live');
  const tp = useTranslations('live.participants');
  // Live feature flags: i flag arrivano come props al mount, ma un moderatore
  // può attivarli/disattivarli DURANTE l'evento → li ripolliamo così i tab
  // reagiscono per tutti. I valori "eff*" sono quelli effettivi correnti.
  // Dal contesto: il canale e' montato una volta sola nel contenitore.
  const pushLive = useLivePush();
  const { data: liveFlags, mutate: mutateFlags } = useSWR<{
    qaEnabled: boolean;
    chatEnabled: boolean;
    agendaEnabled: boolean;
    wordCloudEnabled: boolean;
    liveCaptionsEnabled: boolean;
    recordingEnabled: boolean;
  }>(
    `/api/events/${eventSlug}/flags`,
    (url: string) => fetch(url).then((r) => r.json()),
    // Con il canale vivo i flag arrivano da soli: l'interrogazione periodica
    // resta accesa solo come rete, quando il push non e' disponibile.
    { refreshInterval: pushLive ? 0 : 15000 }
  );
  const effQa = liveFlags?.qaEnabled ?? qaEnabled;
  const effChat = liveFlags?.chatEnabled ?? chatEnabled;
  const effAgenda = liveFlags?.agendaEnabled ?? agendaEnabled;
  // Word cloud is opt-in and OFF by default: the tab stays hidden until the
  // flags poll reports it enabled (no per-event prop → safe default false, so
  // it never flashes on before the real value loads).
  const effWordCloud = liveFlags?.wordCloudEnabled ?? false;
  const effCaptions = liveFlags?.liveCaptionsEnabled ?? liveCaptionsEnabled;
  const showChat = effChat !== false;

  // Toggle di una funzione durante l'evento (moderatore): PUT del flag +
  // refresh ottimistico locale; gli altri client si allineano al prossimo
  // poll (15s).
  const toggleFeature = useCallback(
    async (
      key: FunzioneSala['key'],
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
      return res.ok;
    },
    [eventId, token, mutateFlags]
  );
  const accendiParole = useCallback(() => toggleFeature('wordCloudEnabled', false), [toggleFeature]);
  // Le funzioni che chi conduce accende e spegne per tutti dalla Regia.
  const funzioniSala: FunzioneSala[] = [
    { key: 'qaEnabled', label: t('sidebarTabQa'), on: effQa },
    { key: 'chatEnabled', label: t('sidebarTabChat'), on: effChat },
    { key: 'agendaEnabled', label: t('liveToggleAgenda'), on: effAgenda },
    { key: 'wordCloudEnabled', label: t('sidebarTabWordcloud'), on: effWordCloud },
    ...(liveCaptionsAvailable
      ? [{ key: 'liveCaptionsEnabled' as const, label: t('captions.toggle'), on: effCaptions }]
      : []),
  ];
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    // Chat is the primary channel: prefer it as the initial
    // tab, falling back to Q&A then polls only when chat is disabled.
    showChat ? 'chat' : qaEnabled ? 'qa' : 'polls'
  );
  const [participantCount, setParticipantCount] = useState(0);
  // Mani alzate nella sala, dal pannello dei partecipanti (sempre montato).
  const [handsCount, setHandsCount] = useState(0);
  // Drawer-open state only matters on mobile (<992px); on desktop the column
  // is in the flow, open unless collapsed (`collapsed` below).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Chat unread count — set by ChatPanel via onUnreadCountChange.
  // A chat is "active" when the Chat tab is selected AND (on mobile)
  // the drawer is open.
  const [chatUnread, setChatUnread] = useState(0);
  // Anteprima dell'ultimo messaggio arrivato a chat chiusa: un clic apre la
  // chat, sparisce da sola, e il messaggio successivo la sostituisce.
  const [chatPreview, setChatPreview] = useState<ChatPreview | null>(null);
  useEffect(() => {
    if (!chatPreview) return;
    const durata =
      chatPreview.mentionsMe || chatPreview.repliesToMe ? CHAT_MENTION_PREVIEW_MS : CHAT_PREVIEW_MS;
    const timer = setTimeout(() => setChatPreview(null), durata);
    return () => clearTimeout(timer);
  }, [chatPreview]);
  // Menzioni e risposte non lette: il contatore della chat diventa «@».
  const [chatMentions, setChatMentions] = useState(0);
  // Chi e' nella chiamata adesso, per le @menzioni (bot di registrazione escluso).
  const getRoster = useCallback((): string[] => {
    try {
      return (jitsiApi?.getParticipantsInfo?.() ?? [])
        .filter((p) => isHumanParticipant(p))
        .map((p) => (p.displayName ?? '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }, [jitsiApi]);
  // Sondaggi aperti in cui questa persona non ha ancora votato: il pannello
  // resta montato anche su un'altra scheda apposta per poterlo dire.
  const [pollsUnvoted, setPollsUnvoted] = useState(0);
  // Un pannello e' sotto gli occhi quando e' la scheda scelta E si vede: su
  // desktop a colonna non compressa, sotto i 992px solo a cassetto aperto.
  // E' questo, non la sola scheda scelta, a dire se un messaggio o un
  // materiale nuovo e' gia' stato visto.
  const [isDesktop, setIsDesktop] = useState(true);
  // Chi segue soprattutto la chat allarga la colonna trascinandone il bordo:
  // la videochiamata si restringe di conseguenza, mai sotto i 420 px. La
  // scelta resta nel browser; doppio clic sul bordo torna alla misura iniziale.
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  useEffect(() => {
    try {
      const salvata = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
      if (Number.isFinite(salvata) && salvata > 0) setSidebarWidth(clampSidebarWidth(salvata));
    } catch { /* storage non disponibile: misura predefinita */ }
    const onResize = () => setSidebarWidth((w) => (w === null ? w : clampSidebarWidth(w)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Desktop: la colonna si può comprimere a una striscia di icone, per chi
  // vuole il video più grande o meno elementi intorno. Le schede e i loro
  // contatori restano visibili; un clic su una scheda la riapre.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
    } catch { /* storage non disponibile: si parte aperta */ }
  }, []);
  const impostaCompressa = useCallback((v: boolean) => {
    setCollapsed(v);
    try {
      if (v) window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1');
      else window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
    } catch { /* vale finche' resta aperta la pagina */ }
  }, []);
  const compressa = isDesktop && collapsed;
  const salvaLarghezza = useCallback((w: number | null) => {
    try {
      if (w === null) window.localStorage.removeItem(SIDEBAR_WIDTH_KEY);
      else window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
    } catch { /* storage non disponibile: vale finche' resta aperta la pagina */ }
  }, []);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const onResizerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const colonna = e.currentTarget.parentElement;
    dragRef.current = { x: e.clientX, w: colonna?.getBoundingClientRect().width ?? SIDEBAR_DEFAULT_W };
    e.currentTarget.setPointerCapture(e.pointerId);
    // Durante il trascinamento l'iframe della chiamata non deve catturare il
    // puntatore, altrimenti il bordo si «stacca» appena ci si passa sopra.
    document.documentElement.classList.add('live-resizing');
  }, []);
  const onResizerPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    // La colonna sta a destra: verso sinistra si allarga.
    setSidebarWidth(clampSidebarWidth(d.w + (d.x - e.clientX)));
  }, []);
  const onResizerPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.documentElement.classList.remove('live-resizing');
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* gia' rilasciato */ }
    setSidebarWidth((w) => {
      salvaLarghezza(w);
      return w;
    });
  }, [salvaLarghezza]);
  const onResizerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const passo = e.shiftKey ? 96 : 32;
    let next: number | null | undefined;
    if (e.key === 'ArrowLeft') next = clampSidebarWidth((sidebarWidth ?? SIDEBAR_DEFAULT_W) + passo);
    else if (e.key === 'ArrowRight') next = clampSidebarWidth((sidebarWidth ?? SIDEBAR_DEFAULT_W) - passo);
    else if (e.key === 'Home') next = SIDEBAR_MIN_W;
    else if (e.key === 'End') next = clampSidebarWidth(SIDEBAR_MAX_W);
    else if (e.key === 'Enter') next = null;
    if (next === undefined) return;
    e.preventDefault();
    setSidebarWidth(next);
    salvaLarghezza(next);
  }, [sidebarWidth, salvaLarghezza]);
  useEffect(() => () => document.documentElement.classList.remove('live-resizing'), []);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 992px)');
    const aggiorna = () => setIsDesktop(mq.matches);
    aggiorna();
    mq.addEventListener('change', aggiorna);
    return () => mq.removeEventListener('change', aggiorna);
  }, []);
  const onScreen = (key: SidebarTab) => activeTab === key && (isDesktop ? !compressa : drawerOpen);
  // Aprire una scheda vuol dire mostrarla: su desktop riapre la colonna
  // compressa, sul telefono apre il cassetto. Ogni via per aprire una scheda
  // passa da qui.
  const apriScheda = useCallback(
    (key: SidebarTab) => {
      setActiveTab(key);
      if (isDesktop) impostaCompressa(false);
      else setDrawerOpen(true);
    },
    [isDesktop, impostaCompressa],
  );
  // Una scheda chiesta da fuori (la striscia del tempo apre la Regia).
  useEffect(() => {
    if (richiestaScheda) apriScheda(richiestaScheda.tab);
    // Solo alla nuova richiesta: apriScheda cambia con il layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richiestaScheda?.n]);

  // Entrati nella chiamata, si dice al server quale riquadro e' questo
  // browser (lib/live/seats): chi modera vede accanto al nome l'iscrizione
  // che c'e' dietro. Un nuovo ingresso (riconnessione) ha un endpoint nuovo.
  useEffect(() => {
    if (!localParticipantId || !token) return;
    let annullato = false;
    const dichiara = async (tentativo: number) => {
      try {
        const res = await fetch(`/api/events/${eventSlug}/seats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpointId: localParticipantId }),
        });
        // Rifiutata per il token o per l'id: riprovare non cambia niente.
        if (res.ok || res.status === 403 || res.status === 422) return;
      } catch {
        /* rete: si riprova qui sotto */
      }
      if (!annullato && tentativo < 3) setTimeout(() => void dichiara(tentativo + 1), 5000 * tentativo);
    };
    void dichiara(1);
    return () => {
      annullato = true;
    };
  }, [localParticipantId, token, eventSlug]);
  const isChatActive = onScreen('chat');
  // Aperta la chat, l'anteprima non serve piu'.
  useEffect(() => {
    if (isChatActive) setChatPreview(null);
  }, [isChatActive]);
  // La scheda scelta decide che cosa si disegna; `pollsOnScreen` se si vede.
  const isPollsActive = activeTab === 'polls';
  const pollsOnScreen = onScreen('polls');
  const materialsOnScreen = onScreen('materials');
  // Domande nuove e risposte mentre si guarda altro: pallino sulla scheda e,
  // a chi riguardano, suono o notifica (hooks/use-qa-alerts).
  const { hasNews: qaNews } = useQaAlerts({
    eventSlug,
    token,
    voterGuestId,
    isModerator,
    enabled: effQa,
    onScreen: onScreen('qa'),
  });
  // Materiali nuovi mentre si guarda un'altra scheda: un pallino, come per i
  // sondaggi. Stessa chiave del pannello, quindi stessa richiesta: aprirlo non
  // ne aggiunge una. Con il canale vivo la rilettura la chiede l'avviso
  // `materials`; senza, lo stesso giro del pannello.
  // Una domanda «in una parola» appena aperta mentre si guarda altro: un
  // pallino sulla scheda. Legge la versione leggera (c'e' una domanda aperta,
  // e quale: in caldo sul server, uguale per tutti) e segue gli avvisi del
  // canale, cosi' il pallino compare appena la domanda si apre. Il giro lento
  // resta anche col canale: un'altra istanza dell'app puo' rispondere
  // all'avviso con lo stato di un attimo prima.
  const { data: giroParole } = useSWR<{ active: boolean; id?: string }>(
    effWordCloud && !isModerator ? [`/api/events/${eventSlug}/wordcloud?lite=1`, 'alert', token] : null,
    ([url, , tok]: [string, string, string]) =>
      fetch(url, { headers: tok ? { Authorization: `Bearer ${tok}` } : undefined }).then((r) =>
        r.ok ? r.json() : null,
      ),
    { refreshInterval: 20_000, revalidateOnFocus: false },
  );
  const giriVistiRef = useRef<Set<string>>(new Set());
  const wordcloudOnScreen = onScreen('wordcloud');
  if (wordcloudOnScreen && giroParole?.id) giriVistiRef.current.add(giroParole.id);
  const wordcloudNew =
    !!giroParole?.active && !!giroParole.id && !wordcloudOnScreen && !giriVistiRef.current.has(giroParole.id);
  const { data: materialsData } = useSWR<{ materials: Array<{ id: string }> }>(
    materialsListKey(eventSlug, token),
    fetchMaterials,
    { refreshInterval: pushLive ? 0 : 30_000 },
  );
  const seenMaterialsRef = useRef<Set<string> | null>(null);
  const [materialsNew, setMaterialsNew] = useState(false);
  useEffect(() => {
    if (!materialsData?.materials) return;
    const ids = new Set(materialsData.materials.map((m) => m.id));
    // Al primo elenco, e ogni volta che la scheda e' aperta, quel che c'e' e'
    // visto.
    if (seenMaterialsRef.current === null || materialsOnScreen) {
      seenMaterialsRef.current = ids;
      setMaterialsNew(false);
      return;
    }
    const visti = seenMaterialsRef.current;
    if ([...ids].some((id) => !visti.has(id))) setMaterialsNew(true);
  }, [materialsData, materialsOnScreen]);
  // Il titolo della scheda del browser dice quanti messaggi non letti ci
  // sono mentre si guarda altro: «(3) Titolo». Torna com'era al ritorno.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const PREFISSO = /^\(\d+\+?\) /;
    const pulisci = () => {
      if (PREFISSO.test(document.title)) document.title = document.title.replace(PREFISSO, '');
    };
    if (chatUnread > 0 && document.hidden) {
      pulisci();
      document.title = `(${chatUnread > 99 ? '99+' : chatUnread}) ${document.title}`;
    } else if (chatUnread === 0) {
      pulisci();
    }
    const onVisibility = () => {
      if (!document.hidden) pulisci();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      pulisci();
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
    /** `alert`: un numero da leggere (rosso, con il richiamo animato);
     *  `neutral`: un conteggio informativo (i presenti). */
    badgeTone?: 'alert' | 'mention' | 'neutral';
    dot?: boolean;
    /** Testo del pallino per chi usa uno screen reader: dire «messaggi non
     *  letti» sopra la scheda dei sondaggi è peggio che non dire niente. */
    dotLabel?: string;
    show: boolean;
  }> = [
    // Chat first: it is the primary audience channel, so it
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
      // Il numero dei non letti, non un pallino: a ogni messaggio nuovo il
      // contatore «salta» e finche' non si legge pulsa.
      badge: chatUnread,
      badgeTone: chatMentions > 0 ? 'mention' : 'alert',
      dotLabel: t('sidebarTabChatUnread'),
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
      dot: qaNews,
      dotLabel: t('sidebarTabQaNew'),
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
      // Un sondaggio aperto va notato anche da chi in quel momento sta
      // guardando la chat: senza questo segno, il canale avvisava il pannello
      // e il pannello non avvisava nessuno.
      dot: pollsUnvoted > 0 && !pollsOnScreen,
      dotLabel: t('sidebarTabPollsOpen'),
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
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
      ),
      // Chi conduce la vede anche spenta: dentro c'e' la spiegazione, e la
      // prima domanda la accende per tutti. Era la funzione che nessuno usava
      // perche' andava prima scoperta e accesa da un'altra parte.
      show: effWordCloud || isModerator,
      dot: wordcloudNew,
      dotLabel: t('sidebarTabWordcloudNew'),
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
          <rect x="3" y="4" width="6" height="6" rx="1" />
          <path d="m3 17 2 2 4-4" />
          <path d="M13 6h8" />
          <path d="M13 12h8" />
          <path d="M13 18h8" />
        </svg>
      ),
      show: effAgenda,
    },
    {
      key: 'materials',
      label: t('sidebarTabMaterials'),
      dot: materialsNew && !materialsOnScreen,
      dotLabel: t('sidebarTabMaterialsNew'),
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
      // Le mani alzate vincono sul conteggio, per chi modera: sono la coda da
      // gestire, e la scheda è il posto unico dove gestirla. Altrimenti il
      // conteggio della sala quando c'e': quello del pannello si ferma quando
      // il pannello si chiude.
      badge:
        isModerator && handsCount > 0
          ? handsCount
          : roomCount && roomCount > 0
            ? roomCount
            : participantCount,
      badgeTone: isModerator && handsCount > 0 ? 'alert' : 'neutral',
      dotLabel: isModerator && handsCount > 0 ? tp('handsRaised', { count: handsCount }) : undefined,
      show: true,
    },
    // La Regia per chi conduce, in fondo e dopo i Partecipanti: è un'altra
    // cosa rispetto ai pannelli della sala, e lì non si confonde con loro.
    // Il pubblico non la vede.
    {
      key: 'regia',
      label: t('controlRoom.tab'),
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
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      ),
      dot: !!regia?.isRecording,
      dotLabel: t('recordingActive'),
      show: !!regia,
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
      apriScheda(key);
    },
    [activeTab, drawerOpen, apriScheda]
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
              <span
                // La chiave cambia col numero: il contatore rinasce e la sua
                // animazione d'ingresso riparte a ogni messaggio nuovo.
                key={tab.badgeTone !== 'neutral' ? tab.badge : 'n'}
                className={`live-floating-btn__badge${
                  tab.badgeTone === 'mention' ? ' is-alert is-mention' : tab.badgeTone === 'alert' ? ' is-alert' : ''
                }`}
                aria-hidden="true"
              >
                {tab.badgeTone === 'mention' && '@'}
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            )}
            {/* Un contatore da leggere (non i presenti) arriva anche ai lettori
                di schermo: il numero disegnato è nascosto. */}
            {tab.badge !== undefined && tab.badge > 0 && tab.badgeTone !== 'neutral' && tab.dotLabel && (
              <span className="visually-hidden"> {tab.dotLabel}</span>
            )}
            {tab.dot && (
              <span
                className="live-floating-btn__dot"
                aria-label={tab.dotLabel}
                title={tab.dotLabel}
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

      {chatPreview && (
        <div
          className={`chat-preview${
            chatPreview.mentionsMe || chatPreview.repliesToMe ? ' chat-preview--mention' : ''
          }`}
        >
          <button
            type="button"
            className="chat-preview__open"
            onClick={() => {
              setChatPreview(null);
              apriScheda('chat');
            }}
          >
            <span
              className="chat-preview__avatar"
              style={{ backgroundColor: avatarColor(chatPreview.senderKey || chatPreview.senderName) }}
              aria-hidden="true"
            >
              {avatarInitials(chatPreview.senderName)}
            </span>
            <span className="chat-preview__body">
              <span className="chat-preview__title">
                {chatPreview.mentionsMe
                  ? t('chat.mentionNotificationTitle', { name: chatPreview.senderName })
                  : chatPreview.repliesToMe
                    ? t('chat.replyNotificationTitle', { name: chatPreview.senderName })
                    : t('chat.messageNotificationTitle', { name: chatPreview.senderName })}
              </span>
              <span className="chat-preview__text">{chatPreview.text}</span>
            </span>
          </button>
          <button
            type="button"
            className="chat-preview__close"
            aria-label={tCommon('close')}
            onClick={() => setChatPreview(null)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

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
        className={`d-flex flex-column live-sidebar${drawerOpen ? ' live-sidebar--open' : ''}${
          compressa ? ' live-sidebar--collapsed' : ''
        }`}
        style={
          isDesktop && !compressa && sidebarWidth !== null
            ? { width: sidebarWidth, flexBasis: sidebarWidth, maxWidth: 'none' }
            : undefined
        }
        // Sul telefono il cassetto chiuso esce dallo schermo ma resterebbe
        // raggiungibile con il tasto Tab: chiuso, è inerte.
        inert={!isDesktop && !drawerOpen ? true : undefined}
      >
        {isDesktop && (
          <button
            type="button"
            className="live-sidebar-collapse"
            onClick={() => impostaCompressa(!compressa)}
            aria-expanded={!compressa}
            aria-controls="live-sidebar-body"
            aria-label={compressa ? t('expandSidebar') : t('collapseSidebar')}
            title={compressa ? t('expandSidebar') : t('collapseSidebar')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {/* Una freccia sola, che ruota (globals.scss): verso destra
                  comprime, verso sinistra riapre. */}
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
        {isDesktop && !compressa && (
          <div
            className="live-sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={t('resizeSidebar')}
            aria-valuenow={sidebarWidth ?? SIDEBAR_DEFAULT_W}
            aria-valuemin={SIDEBAR_MIN_W}
            aria-valuemax={SIDEBAR_MAX_W}
            title={t('resizeSidebar')}
            tabIndex={0}
            onPointerDown={onResizerPointerDown}
            onPointerMove={onResizerPointerMove}
            onPointerUp={onResizerPointerUp}
            onPointerCancel={onResizerPointerUp}
            onKeyDown={onResizerKeyDown}
            onDoubleClick={() => {
              setSidebarWidth(null);
              salvaLarghezza(null);
            }}
          />
        )}
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
                onClick={() => apriScheda(tab.key)}
              >
                <span className="live-floating-btn__icon" aria-hidden="true">
                  {tab.svg}
                </span>
                <span className="live-sidebar-tab__label">{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    key={tab.badgeTone !== 'neutral' ? tab.badge : 'n'}
                    className={`live-sidebar-tab__badge${
                      tab.badgeTone === 'mention'
                        ? ' is-alert is-mention'
                        : tab.badgeTone === 'alert'
                          ? ' is-alert'
                          : ' is-neutral'
                    }`}
                  >
                    {tab.badgeTone === 'mention' && '@'}
                    {tab.badge > 99 ? '99+' : tab.badge}
                    {tab.badgeTone !== 'neutral' && tab.dotLabel && (
                      <span className="visually-hidden"> {tab.dotLabel}</span>
                    )}
                  </span>
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
          id="live-sidebar-body"
          className={`flex-grow-1 ${compressa ? 'd-none' : 'd-flex'} flex-column live-sidebar-body`}
          style={{ minHeight: 0, overflowY: 'auto' }}
        >
          {activeTab === 'regia' && regia && (
            <ControlRoomPanel
              api={jitsiApi}
              eventId={eventId}
              token={token}
              onEnded={regia.onEnded}
              modalContainer={regia.modalContainer}
              recordingEnabled={regia.recordingEnabled}
              isRecording={regia.isRecording}
              faseRegistratore={regia.faseRegistratore}
              registrazione={regia.registrazione}
              funzioni={funzioniSala}
              onToggleFunzione={(key, on) => void toggleFeature(key, on)}
              lavagna={whiteboardEnabled && whiteboardInfraReady}
              eventSlug={eventSlug}
            />
          )}
          {activeTab === 'qa' && effQa && (
            <QAPanel
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
              guestName={!token ? displayName : undefined}
              guestId={!token ? voterGuestId : undefined}
              voterAccessToken={voterAccessToken}
              voterGuestId={voterGuestId}
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
                onPreview={setChatPreview}
                onUnreadMentionsChange={setChatMentions}
                getRoster={getRoster}
              />
            </div>
          )}
          {/* Come la chat: MONTATO anche quando la scheda non è quella attiva,
              perché è il pannello stesso a sapere se c'è un sondaggio da
              votare — e non può dirlo se viene smontato. Nascosto con
              d-flex/d-none: le utility di Bootstrap Italia sono !important e
              vincono su un `display` inline. */}
          <div
            className={`flex-column flex-grow-1 ${isPollsActive ? 'd-flex' : 'd-none'}`}
            style={{ minHeight: 0 }}
          >
            <PollPanel
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
              voterAccessToken={voterAccessToken}
              voterGuestId={voterGuestId}
              active={pollsOnScreen}
              onUnvotedCountChange={setPollsUnvoted}
              presentCount={roomCount && roomCount > 0 ? roomCount : participantCount}
            />
          </div>
          {activeTab === 'wordcloud' && (effWordCloud || isModerator) && (
            <WordCloud
              eventSlug={eventSlug}
              token={token}
              isModerator={isModerator}
              voterAccessToken={voterAccessToken}
              voterGuestId={voterGuestId}
              enabled={effWordCloud}
              onEnable={accendiParole}
            />
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
          {/* Sempre montato, come chat e sondaggi: segue mani alzate e chi sta
              parlando anche mentre si guarda un'altra scheda. */}
          <div className={activeTab === 'participants' ? 'd-block' : 'd-none'}>
            <ParticipantPanel
              api={jitsiApi}
              isModerator={isModerator}
              localParticipantId={localParticipantId}
              onCountChange={setParticipantCount}
              onHandsChange={setHandsCount}
              visible={onScreen('participants')}
              eventSlug={eventSlug}
              token={token}
            />
          </div>
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
   *  the registration total is never leaked to attendees. */
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
  /** Una chiamata istantanea non ha una pagina pubblica da condividere. */
  hasPublicPage?: boolean;
  /** Il link senza token fa entrare (vedi `EventInfo.guestEntryOpen`). */
  hasCallLink?: boolean;
  /** Privileged moderator magic-link token — passed ONLY when the current
   *  user is a moderator, so the token never enters a non-moderator tree.
   *  Surfaced (collapsed, with a warning) in the share popup. */
  moderatorToken?: string;
  onLeaveRoom?: () => void;
  /** App-owned fullscreen: current state + toggle. Passed only by the
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
  hasPublicPage = true,
  hasCallLink = true,
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

  return (
    <div
      className="text-white px-3 py-2 d-flex align-items-center justify-content-between live-top-bar"
      style={{
        background: 'linear-gradient(90deg, #004D99 0%, #0066CC 100%)',
        boxShadow: '0 2px 8px rgba(0, 40, 85, 0.3)',
      }}
    >
      <div className="d-flex align-items-center live-top-bar__lead">
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
        {/* La miniatura solo se l'evento ha un'immagine: l'iniziale del
            titolo in un quadratino non diceva niente a nessuno. */}
        {thumbUrl && (
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
          className="px-2 py-1 me-2 live-role-badge"
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
         *  under-reported. The sidebar remains the single
         *  source of truth for the present-participant count. */}
      </div>
      {/* L'argomento in corso dell'agenda, per chi segue chiamata e chat
          senza aprire il pannello: si apre sull'elenco completo. Sul telefono
          va su una riga sua, sotto titolo e comandi. */}
      <AgendaTicker eventSlug={slug} isModerator={role === 'moderator'} />
      <div className="live-top-bar__actions d-flex align-items-center gap-2">
        {/* Un'icona, non una fascia: chi è in sala sa che si registra senza
            perdere una riga di video. Il ruolo status la annuncia quando
            compare. Chi conduce la trova, con la durata, nella striscia del
            tempo. */}
        {isRecording && role !== 'moderator' && (
          <span className="live-rec-indicator" title={t('recordingActive')} aria-hidden="true">
            <span className="live-rec-indicator__dot" />
            {t('recordingShort')}
          </span>
        )}
        {/* La regione resta montata e cambia testo: un contenitore che nasce
            già pieno molti lettori di schermo non lo annunciano. */}
        <span className="visually-hidden" role="status">
          {isRecording ? t('recordingActive') : ''}
        </span>
        {/* The "active vs registered" figure is moderator-only:
            participants shouldn't see attendance numbers. The live people-count
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
            {/* it-expand/it-collapse are the ACCORDION chevrons in the Bootstrap
                Italia sprite, so this icon-only button read as "open a panel".
                it-fullscreen is the four-corners glyph people expect here. */}
            <Icon icon={isFullscreen ? 'it-collapse' : 'it-fullscreen'} size="xs" color="white" />
          </Button>
        )}
        <LiveShareButton
          slug={slug}
          locale={locale}
          moderatorToken={moderatorToken}
          hasPublicPage={hasPublicPage}
          hasCallLink={hasCallLink}
        />
        {onLeaveRoom && (
          <Button
            color="danger"
            outline
            size="xs"
            className="leave-room-btn"
            onClick={onLeaveRoom}
            aria-label={t('leaveRoom')}
          >
            <Icon icon="it-logout" size="xs" color="white" />
            <span className="leave-room-btn__text">{t('leaveRoom')}</span>
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
// but attendees on a live event reported missing the transition
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
      const info = api.getParticipantsInfo().find((p) => p.participantId === evt.id);
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
        // Fascia informativa chiara, come gli avvisi della sala: il bianco
        // sull'arancio di prima non arrivava al contrasto minimo (circa 2,5:1).
        background: '#E6F0FA',
        color: '#004D99',
        borderBottom: '1px solid #CFE0F3',
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
