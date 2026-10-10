'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations, useFormatter } from 'next-intl';
import {
  Alert,
  Button,
  Card,
  CardBody,
  FormGroup,
  Input,
  Spinner,
} from 'design-react-kit';

import { Icon } from '@/components/ui/icon';
import { Link, percorso } from '@/i18n/navigation';
import { resolveWaitingRoomMode } from '@/lib/waiting-room/resolve-engine';
import { canStartManually } from '@/lib/events/lifecycle';
import {
  annuncioApertura,
  statoIngresso,
  type BloccoModulo,
} from '@/lib/waiting-room/entry-state';
import ProfilePhotoField from '@/components/live/profile-photo-field';
import AudioPlayer from '@/components/live/audio-player';
import ChatPanel from '@/components/live/chat-panel';
import DeviceCheck from '@/components/live/device-check';
import { InsecureContextNotice } from '@/components/live/insecure-context';
import VideoPlayer from '@/components/events/video-player';
import EventTitle from '@/components/events/event-title';
import LiveShareButton from '@/components/live/live-share-button';
import { MarkdownRenderer } from '@/components/ui/markdown';
import type { EntePubblico, PersonaPubblica } from '@/lib/events/public-people';
import type { Presenze } from '@/lib/live/presence';
import { PonteChatPiazza } from '@/lib/lobby/chat-bridge';
import type { DatiBacheca, MostraGalleria } from '@/components/live/garden/piazza-luoghi';

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
 * participant, moderator, speaker) no matter the event status. It
 * consolidates:
 *   - cover image / hero
 *   - name input (always editable, prefilled where we know it)
 *   - netiquette reminder
 *   - audio player while waiting
 *   - countdown (PUBLISHED only)
 *   - catch-up recording (whenever tempRecordingUrl is set — no 5min gate)
 *   - chat preview while LIVE
 *   - the recording consents still to give, with the event's privacy notice
 *   - primary CTA: enter, start (moderator), watch recording, feedback
 *
 * The JWT fetch, and the choice of which consents to ask, stay in the parent
 * `LiveEventClient`: the waiting room presents, and reports back through
 * `onEnterLive(name, prefs)` and `onStartEvent()`.
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
  /** Mostra l'avviso di registrazione: l'evento registra E l'installazione
   *  ha qualcosa che puo' farlo (lo combina LiveEventClient). */
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
  /** In sala ci saranno i sottotitoli live: l'audio di chi parla viene
   *  trascritto mentre parla (ADR-018). Solo un avviso: nulla viene salvato. */
  liveCaptions?: boolean;
  /** L'evento registra una traccia audio separata per partecipante:
   *  richiede consenso esplicito (hard-gate) prima di entrare. */
  multitrackRecordingEnabled?: boolean;
  /** La trascrizione dai sottotitoli e' attiva: si chiede il consenso. */
  captionsTranscript?: boolean;
  /** Descrizione, enti e persone, come sulla pagina pubblica. */
  riepilogo?: RiepilogoSala;
}

/** Il riepilogo della chiamata: descrizione (Markdown), enti e persone
 *  pubblicate (lib/events/public-people). */
export interface RiepilogoSala {
  descrizione: string | null;
  enti: EntePubblico[];
  persone: PersonaPubblica[];
}

export interface WaitingRoomJoinPrefs {
  /** Whether the user wants their camera on when they land in Jitsi. */
  cameraOn: boolean;
  /** Whether the user wants their microphone on when they land in Jitsi. */
  micOn: boolean;
  /** Consenso alla registrazione dell'evento dato qui: il server lo registra
   *  come prova quando rilascia il JWT. */
  recordingConsent?: boolean;
  /** Consenso alla registrazione per partecipante dato qui: il server lo
   *  registra come prova quando rilascia il JWT. */
  multitrackConsent?: boolean;
}

/** Telemetria warm-up dal poll /lifecycle: alimenta il pannello di attesa
 *  onesto (fase + tempo trascorso) al posto dello spinner cieco. */
export interface WaitingRoomWarmup {
  /** 'scheduled': nessuno scaler, il bridge è fisso — la sala si apre
   *  all'orario d'inizio o quando il moderatore avvia l'evento, e non c'è
   *  nessun riscaldamento da stimare. */
  phase: 'queued' | 'starting' | 'ready' | 'scheduled';
  /** Stopwatch anchor, già ripulito lato server: valorizzato solo mentre
   *  PROVISIONING e recente (null in IDLE / se residuo di un ciclo passato),
   *  così il cronometro non parte mai da un timestamp stantìo. */
  startedAt: string | null;
  serverTime: string;
}

interface WaitingRoomProps {
  event: WaitingRoomEvent;
  /** Quanti sono in diretta e quanti in sala d'attesa (null = non si sa). */
  presenze?: Presenze | null;
  /** I link da condividere (pulsante «Condividi»). */
  condivisione?: {
    locale: string;
    moderatorToken?: string;
    hasPublicPage: boolean;
    hasCallLink: boolean;
  };
  role: 'moderator' | 'participant' | 'guest';
  /** Chi conduce o interviene: la scelta di fotocamera e microfono si ricorda
   *  a parte da quella di chi assiste. Per tutti partono spenti. */
  conduce?: boolean;
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
  /** Va chiesto qui il consenso alla registrazione dell'evento: chi partecipa
   *  puo' accendere microfono, videocamera o schermo e non l'ha dato
   *  all'iscrizione (ospite dal link della sala, iscritto da un altro
   *  browser, iscritto prima che la registrazione fosse attivata). */
  recordingConsentRequired?: boolean;
  /** Si registra, ma chi partecipa non ha ne' microfono, ne' videocamera, ne'
   *  schermo: il riepilogo lo dice, e non c'e' nulla da acconsentire. */
  recordingListenOnly?: boolean;
  /** Il testo sulla registrazione scelto per l'evento; null = quello predefinito. */
  recordingConsentText?: string | null;
  /** L'informativa privacy dell'evento, accanto al consenso. */
  privacy?: { url: string; testo?: string };
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

/** Il campo su cui portare il fuoco per ciascun blocco. */
const CAMPO_DEL_BLOCCO: Record<BloccoModulo, string> = {
  name: 'waiting-name',
  email: 'waiting-email',
  recording: 'waiting-recording-consent',
};
/** La casella della trascrizione dei propri interventi: facoltativa, non blocca. */
const CAMPO_TRASCRIZIONE = 'waiting-multitrack-consent';
/** Il messaggio che spiega ciascun blocco: descrive il campo e il pulsante. */
const MESSAGGIO_DEL_BLOCCO: Record<BloccoModulo, string> = {
  name: 'waiting-name-required',
  email: 'waiting-email-invalid',
  recording: 'waiting-recording-consent-required',
};

/** Le due colonne della sala d'attesa: nella piazza quella con la chat viene
 *  prima. */
function inOrdine<T>(colonne: T[], chatPrima: boolean): T[] {
  return chatPrima ? [...colonne].reverse() : colonne;
}

export default function WaitingRoom({
  event,
  presenze = null,
  condivisione,
  role,
  conduce = false,
  jvbReady,
  defaultName,
  onEnterLive,
  onStartEvent,
  onLeaveFeedback,
  warmup = null,
  exitHref,
  multitrackConsentExempt = false,
  recordingConsentRequired = false,
  recordingListenOnly = false,
  recordingConsentText = null,
  privacy,
  chatToken = '',
  eventType = 'SCHEDULED',
}: WaitingRoomProps) {
  const t = useTranslations('waiting');
  const te = useTranslations('events');
  const tc = useTranslations('common');
  const tGdpr = useTranslations('gdpr.consent');
  const tReg = useTranslations('registration');
  const format = useFormatter();

  const [countdown, setCountdown] = useState('');
  const [startingEvent, setStartingEvent] = useState(false);
  const [watchingCatchUp, setWatchingCatchUp] = useState(false);
  const [pulseCountdown, setPulseCountdown] = useState(false);
  // PUBLISHED con orario di inizio già passato ma il moderatore non ha ancora
  // premuto "Avvia evento": mostriamo uno stato dedicato invece del countdown
  // vuoto + CTA "Apertura alle {ora passata}" (incoerente e sfiduciante).
  const [startingSoon, setStartingSoon] = useState(false);
  // Mai aperto (PUBLISHED, in preparazione o in pausa) e oltre la fine
  // programmata: l'evento non si è tenuto. Il giro del ciclo di vita lo
  // chiuderà a momenti; fino ad allora «attendi l'organizzatore», la
  // preparazione in corso o «Avvia evento» sarebbero promesse false.
  // Calcolato in un effetto (non nel rendering) perché server e prima passata
  // del client coincidano.
  const [notHeld, setNotHeld] = useState(false);
  const [name, setName] = useState(defaultName);
  // Diventa vero dopo aver letto il nome salvato nel browser: fino ad allora
  // un campo vuoto non vuol dire che il nome manchi.
  const [nomeNoto, setNomeNoto] = useState(false);
  const [email, setEmail] = useState('');
  // Full-screen park (default) vs. static classic card (accessibility
  // fallback). Initialised false to match SSR, then synced from storage.
  const [classicView, setClassicView] = useState(false);
  // La piazza si apre su richiesta: vedi il commento su piazzaCard.
  const [gameOpen, setGameOpen] = useState(false);
  // La chat dell'evento vista dalla piazza (fumetti, puntini, correzioni):
  // passa dal ponte, non dallo stato, vedi lib/lobby/chat-bridge.
  const [ponteChat] = useState(() => new PonteChatPiazza());
  // Fotocamera e microfono partono spenti: li accende chi vuole provarli (o
  // li ritrova come li aveva lasciati), e lo dice DeviceCheck.
  const [devicePrefs, setDevicePrefs] = useState<WaitingRoomJoinPrefs>({
    cameraOn: false,
    micOn: false,
  });
  // La descrizione si apre per intero solo se richiesto, e il comando c'è
  // solo se il testo è davvero più lungo dello spazio.
  const [descrizioneAperta, setDescrizioneAperta] = useState(false);
  const [descrizioneLunga, setDescrizioneLunga] = useState(false);
  const descrizioneRef = useRef<HTMLDivElement>(null);
  const descrizioneContenutoRef = useRef<HTMLDivElement>(null);
  // Si osserva il CONTENUTO, non il riquadro tagliato: un'immagine o un
  // carattere che arriva dopo allunga il testo senza cambiare il riquadro.
  useEffect(() => {
    const riquadro = descrizioneRef.current;
    const contenuto = descrizioneContenutoRef.current;
    if (!riquadro || !contenuto || descrizioneAperta) return;
    const misura = () => setDescrizioneLunga(contenuto.offsetHeight > riquadro.clientHeight + 2);
    misura();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(misura) : null;
    ro?.observe(contenuto);
    return () => ro?.disconnect();
  }, [descrizioneAperta, event.riepilogo?.descrizione]);
  const [startError, setStartError] = useState('');
  // Consenso alla registrazione dell'evento, per chi non l'ha dato
  // all'iscrizione.
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [informativaAperta, setInformativaAperta] = useState(false);
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
    setNomeNoto(true);
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
  const endsAtMs = new Date(event.endsAt).getTime();
  const isLive = event.status === 'LIVE';
  // Un evento mai aperto oltre la sua fine si presenta come concluso: niente
  // modulo d'ingresso, niente piazza, niente avvio.
  const isEnded = event.status === 'ENDED' || notHeld;
  const isPublished = event.status === 'PUBLISHED';
  // IDLE = bridge scaled to zero, /wake just fired from LiveEventClient.
  // PROVISIONING = scaler picked up the wake, JVB is starting.
  // Both are short-lived "warming up" states — show a non-blocking
  // banner so the user knows entry is gated, and let them keep using
  // the rest of the room (garden, name input, device check, chat).
  const isWarmingUp =
    (event.status === 'IDLE' || event.status === 'PROVISIONING') && !notHeld;
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
  // La trascrizione dei propri interventi, con il proprio nome: si chiede se
  // l'evento registra una traccia audio per persona (ADR-013) o tiene la
  // trascrizione dai sottotitoli. E' facoltativa e non ferma l'ingresso: chi
  // non la da' entra, ma la sua voce non si registra ne' si trascrive (lo
  // decide il server, voce per voce).
  const trascrizioneChiesta =
    (!!event.multitrackRecordingEnabled || !!event.captionsTranscript) &&
    !isEnded &&
    !multitrackConsentExempt;
  // Il consenso alla registrazione dell'evento, se va chiesto qui. Non ferma
  // la piazza: il cancello passa dallo stesso controllo del pulsante, che
  // porta alla casella.
  const recordingRequired = recordingConsentRequired && !isEnded;
  // La piazza e' disponibile quando c'e' qualcosa da fare e nessun cancello
  // davanti: a evento finito non serve, in vista classica e' stata rifiutata,
  // e senza consenso multitraccia non si va da nessuna parte.
  const canPlay = !isEnded && !classicView;
  // La piazza non è una pagina diversa: è questa pagina, ridisposta accanto
  // alla scena. Un albero solo, quindi quello che c'è nella sala d'attesa c'è
  // anche nella piazza, e aprendo e chiudendo la piazza React non smonta
  // nulla: l'anteprima della fotocamera resta accesa e la bozza in chat resta.
  const piazzaOpen = canPlay && gameOpen;

  // La sala e' pronta quando il ponte video c'e'. Si blocca SOLO su «si sta
  // accendendo adesso»: gli altri valori — nessuno lo ha chiesto, sonda muta,
  // conto andato in errore — non sono un no, e trattarli come tale
  // chiuderebbe la porta a una conferenza sana.
  const pontePresunto = jvbReady !== false;
  // E comunque il cancello non puo' diventare una trappola. La misura viene da
  // una fotografia che un lavoro periodico aggiorna: se quel lavoro e' fermo,
  // o se due eventi si contendono i bridge, «si sta accendendo» resta scritto
  // su una sala che funziona. Dopo un minuto si offre di entrare lo stesso:
  // aspettare per niente e' un fastidio, non poter entrare e' un evento perso.
  const [attesaLunga, setAttesaLunga] = useState(false);
  useEffect(() => {
    if (pontePresunto) {
      setAttesaLunga(false);
      return;
    }
    const t = setTimeout(() => setAttesaLunga(true), 60_000);
    return () => clearTimeout(t);
  }, [pontePresunto]);

  // Due cose diverse, e vanno tenute diverse.
  //
  // `salaPronta` e' cio' che SAPPIAMO: il ponte c'e'. Muove le porte della
  // piazza e l'annuncio «e' pronta, entra».
  //
  // `ingressoConsentito` e' cio' che PERMETTIAMO: dopo un minuto si prova
  // comunque, perche' la misura puo' sbagliare. Ma non si annuncia niente —
  // dire «la sala e' pronta» proprio quando l'unica prova che abbiamo dice il
  // contrario manderebbe le persone a sbattere con una promessa nostra.
  const salaPronta = pontePresunto;
  const ingressoConsentito = salaPronta || attesaLunga;

  // L'apertura va notata. Il passaggio da «aspetta» a «entra» avviene mentre
  // la persona sta guardando altrove — la piazza, la chat, la propria
  // anteprima — e un pulsante che cambia in silenzio se lo perde. Per qualche
  // secondo si illumina e chiede di entrare, poi torna normale: un richiamo
  // che non smette diventa rumore.
  const [appenaAperta, setAppenaAperta] = useState(false);
  // L'apertura e' il momento in cui si puo' entrare davvero: evento avviato
  // E ponte presente. Guardare solo il ponte perderebbe il caso piu' comune —
  // il moderatore avvia con il ponte gia' caldo, e il ponte non e' mai stato
  // «non pronto» agli occhi di chi aspettava.
  const salaAperta = canEnterLive && salaPronta;
  const eraAperta = useRef(salaAperta);
  // Un tentativo d'ingresso con il modulo incompleto — il pulsante, il
  // cancello della piazza, il ritorno dalla registrazione — trasforma
  // l'indicazione in errore e porta il fuoco sul campo da completare.
  const [ingressoTentato, setIngressoTentato] = useState(false);
  const [campoDaCompletare, setCampoDaCompletare] = useState<{
    blocco: BloccoModulo;
    n: number;
  } | null>(null);
  // Sala non pronta e modulo incompleto sono due ragioni diverse per non
  // entrare, con due risposte diverse: vedi lib/waiting-room/entry-state.
  const { canEnter, bloccoModulo, nomeDaChiedere, nomeSegnalato, bloccoSpiegato } =
    statoIngresso({
      canEnterLive,
      ingressoConsentito,
      nameValid,
      emailValid,
      recordingRequired,
      recordingConsent,
      ingressoTentato,
      nomeNoto,
    });

  useEffect(() => {
    if (!salaAperta) {
      // Se la sala si richiude — il ponte sparisce, la fotografia torna
      // indietro — il richiamo va spento: resterebbe un invito a entrare
      // dove non si entra.
      setAppenaAperta(false);
      eraAperta.current = false;
      return undefined;
    }
    if (eraAperta.current) return undefined;
    eraAperta.current = true;
    setAppenaAperta(true);
    const t = setTimeout(() => setAppenaAperta(false), 10_000);
    return () => clearTimeout(t);
  }, [salaAperta]);

  // Il richiamo si vede solo se il pulsante fa davvero entrare. Lampeggiare di
  // verde con il nome ancora da scrivere o il consenso non dato prometterebbe
  // un ingresso che quel clic non dara': in quel caso compare, accanto al
  // campo e sopra il pulsante, la richiesta di cio' che manca.
  const evidenziaCta = appenaAperta && canEnter;
  const annuncio = annuncioApertura({ appenaAperta, canEnter, bloccoModulo: bloccoSpiegato });

  // Il fuoco va sul campo da completare DOPO il disegno: chi arriva dal
  // riproduttore della registrazione non ha ancora il modulo sullo schermo.
  useEffect(() => {
    if (!campoDaCompletare || typeof document === 'undefined') return;
    const el = document.getElementById(CAMPO_DEL_BLOCCO[campoDaCompletare.blocco]);
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [campoDaCompletare]);

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
      if (now >= endsAtMs) {
        setCountdown('');
        setPulseCountdown(false);
        setStartingSoon(false);
        return;
      }
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
  }, [isPublished, startsAtMs, endsAtMs]);

  // «Non si è tenuto»: vale per ogni stato da cui l'evento si potrebbe ancora
  // avviare (vedi canStartManually), non solo per PUBLISHED.
  useEffect(() => {
    if (!canStartManually(event.status)) {
      setNotHeld(false);
      return;
    }
    const check = () => setNotHeld(Date.now() >= endsAtMs);
    check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [event.status, endsAtMs]);

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

  // Un tentativo con il modulo incompleto: si dice cosa manca e si porta la
  // persona li'. Falso se il modulo e' a posto (a trattenere e' la sala).
  const segnalaCampoMancante = useCallback((): boolean => {
    if (!bloccoModulo) return false;
    setIngressoTentato(true);
    setCampoDaCompletare((prev) => ({ blocco: bloccoModulo, n: (prev?.n ?? 0) + 1 }));
    return true;
  }, [bloccoModulo]);

  // L'unico cancello del modulo: il pulsante «Entra» resta premibile, quindi
  // nome, email e consenso alla registrazione li trattiene questo controllo.
  // Ogni ingresso passa di qui (waiting-room.test.tsx lo verifica).
  const handleEnterLive = useCallback(() => {
    if (!canEnter) {
      segnalaCampoMancante();
      return;
    }
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
    onEnterLive(trimmedName, {
      ...devicePrefs,
      ...(recordingRequired && recordingConsent ? { recordingConsent: true } : {}),
      ...(trascrizioneChiesta && multitrackConsent ? { multitrackConsent: true } : {}),
    });
  }, [
    canEnter,
    segnalaCampoMancante,
    onEnterLive,
    trimmedName,
    trimmedEmail,
    devicePrefs,
    recordingRequired,
    recordingConsent,
    trascrizioneChiesta,
    multitrackConsent,
  ]);

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
    // Rete di sicurezza: il cancello della piazza non lascia passare mentre la
    // sala si prepara, ma se un domani lo facesse, mandare la persona a
    // sistemare il nome — che e' gia' a posto — le farebbe cercare un errore
    // che non ha fatto.
    if (!segnalaCampoMancante()) {
      throw new Error(t('roomNotReadyButton'));
    }
    throw new Error('waiting-room: pre-join not complete');
  }, [canEnter, handleEnterLive, segnalaCampoMancante, t]);

  const handleDeviceStateChange = useCallback(
    (s: WaitingRoomJoinPrefs) => setDevicePrefs(s),
    [],
  );

  // Tastiera nella piazza: entrarci porta il focus sull'uscita, uscirne lo
  // riporta all'invito.
  const gameDialogRef = useRef<HTMLDivElement>(null);
  const inviteRef = useRef<HTMLButtonElement>(null);
  const classicToggleRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef(false);
  useEffect(() => {
    if (!gameOpen) {
      if (returnFocusRef.current) {
        returnFocusRef.current = false;
        // L'invito, se c'è ancora; passando alla versione classica sparisce, e
        // allora il posto giusto è il pulsante che riporta indietro.
        (inviteRef.current ?? classicToggleRef.current)?.focus();
      }
      return;
    }
    // Sulla SCENA, non sul pulsante di uscita: il gioco cede i tasti a
    // qualunque controllo a fuoco, quindi partire dal pulsante lasciava
    // l'avatar immobile finché non si cliccava sul canvas. Da qui il Tab
    // raggiunge uscita, versione classica e tutti i controlli della pagina.
    gameDialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Non mentre si scrive: Esc in un campo di testo (o in chat) significa
      // "annulla quello che sto scrivendo", non "chiudi la piazza". Il pannello
      // dei controlli è pieno di campi, e sono gli stessi della pagina.
      const el = e.target as HTMLElement | null;
      // Esc con una finestra aperta sopra la piazza (l'editor del
      // personaggio, la bacheca…) chiude la finestra, non la piazza: anche
      // quando il fuoco è ricaduto sul corpo della pagina.
      if (document.querySelector('dialog[open]')) return;
      if (
        el &&
        (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)
      ) {
        return;
      }
      closePiazza();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                  // Tornare indietro deve funzionare SEMPRE: questi due
                  // pulsanti sono l'unica strada fuori dal riproduttore, e
                  // disabilitarli ci intrappolava dentro chi non ha ancora
                  // scritto il nome o sta aspettando la sala.
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

  // Chiudere la piazza rimette a fuoco l'invito da cui si è entrati: senza,
  // il focus resta su un pulsante che non esiste più e chi naviga da tastiera
  // riparte dall'inizio del documento.
  const closePiazza = () => {
    setGameOpen(false);
    returnFocusRef.current = true;
  };

  // "Versione classica": chiude la piazza E ricorda la scelta. `classicView`
  // spegne `canPlay`, quindi l'invito non si ripresenta — né ora né al
  // prossimo evento.
  const goClassic = () => {
    setGameOpen(false);
    toggleClassic(true);
    returnFocusRef.current = true;
  };

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
  // A sala aperta il pulsante «Entra» resta premibile anche senza nome: un
  // pulsante spento non dice perche' lo e'. Qui si dice, accanto al campo —
  // prima come indicazione, dopo un tentativo come errore — e il campo lo
  // annuncia a chi usa un lettore di schermo.
  const nameDescribedBy =
    [isGuest ? 'waiting-name-help' : null, nomeDaChiedere ? MESSAGGIO_DEL_BLOCCO.name : null]
      .filter(Boolean)
      .join(' ') || undefined;
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
        autoComplete="name"
        // Niente rosso: un nome che manca è una cosa da fare, non un errore.
        // Il campo lampeggia (vedi .wr-name-field--empty), e dopo un
        // tentativo lo dice anche ai lettori di schermo.
        className={nomeSegnalato ? 'wr-name-input--attention' : undefined}
        aria-invalid={nomeSegnalato || undefined}
        aria-describedby={nameDescribedBy}
      />
      {isGuest && (
        <small id="waiting-name-help" className="text-muted" style={{ fontSize: '0.8rem' }}>
          {t('nameHelp')}
        </small>
      )}
      {nomeDaChiedere && (
        <div
          id={MESSAGGIO_DEL_BLOCCO.name}
          className={`wr-name-hint${nomeSegnalato ? ' wr-name-hint--insist' : ''}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          <span>{t('nameRequiredToEnter')}</span>
        </div>
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
        aria-describedby={!emailValid ? MESSAGGIO_DEL_BLOCCO.email : undefined}
        autoComplete="email"
      />
      <small className="text-muted" style={{ fontSize: '0.8rem' }}>
        {t('emailHelp')}
      </small>
      {!emailValid && (
        <div
          id={MESSAGGIO_DEL_BLOCCO.email}
          className="small text-danger mt-1"
          style={{ fontSize: '0.8rem' }}
        >
          {t('emailInvalid')}
        </div>
      )}
    </FormGroup>
  );

  const deviceCheckField = (
    <DeviceCheck conduce={conduce} onStateChange={handleDeviceStateChange} />
  );

  // Le buone pratiche si aprono a richiesta: chi le conosce non le rilegge.
  const netiquetteBlock = (
    <details className="wr-netiquette">
      <summary>
        <Icon icon="it-info-circle" size="xs" className="me-2" />
        {t('netiquetteTitle')}
      </summary>
      <ul>
        <li>{t('netiquetteBullet1')}</li>
        <li>{t('netiquetteBullet2')}</li>
        <li>{t('netiquetteBullet3')}</li>
        <li>{t('netiquetteBullet4')}</li>
      </ul>
    </details>
  );

  // Informativa AI in sala d'attesa: mostrata quando l'evento usa la
  // pipeline AI post-evento. Testo custom dell'admin (per-locale) con
  // fallback al testo generico i18n. NIENTE <Icon> dentro <Alert>:
  // Bootstrap Italia ne disegna già una via ::before.
  const aiConsentText =
    event.aiConsentDisclosure && event.aiConsentDisclosure.trim()
      ? event.aiConsentDisclosure
      : t('aiNotice');
  const aiNoticeBlock = event.aiPostprodEnabled && !isEnded ? (
    <div className="wr-info">
      <span className="wr-info__icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 5.6 5.6 1.9-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
        </svg>
      </span>
      <span>
        <span className="wr-info__title">{t('aiNoticeTitle')}</span>
        {aiConsentText}
      </span>
    </div>
  ) : null;

  // Avviso dei sottotitoli live: chi parla in sala viene trascritto in tempo
  // reale, nel cluster dell'ente, e il testo non viene conservato. Non chiede
  // un consenso: è trasparenza su un trattamento in corso, come l'avviso AI.
  const captionsNoticeBlock = event.liveCaptions && !isEnded ? (
    <div className="wr-info">
      <span className="wr-info__icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 15h4M13 15h4M7 11h10" />
        </svg>
      </span>
      <span>
        <span className="wr-info__title">{t('captionsNoticeTitle')}</span>
        {event.captionsTranscript ? t('captionsNoticeTranscript') : t('captionsNotice')}
      </span>
    </div>
  ) : null;

  // I consensi da dare prima di entrare: alla registrazione dell'evento, per
  // chi non l'ha dato all'iscrizione, e alla traccia audio per partecipante.
  // Senza la spunta `canEnter` è false e il pulsante «Entra» porta il fuoco
  // sulla casella. Non è un <Alert>: serve un input, e l'icona ::before
  // finirebbe sopra il testo.
  const informativa = privacy ? (
    <div className="wr-consensi__privacy">
      {privacy.testo ? (
        <>
          <button
            type="button"
            className="btn btn-link p-0 wr-consensi__link"
            aria-expanded={informativaAperta}
            aria-controls="wr-consensi-informativa"
            onClick={() => setInformativaAperta((v) => !v)}
          >
            {tReg('gdprLink')}
          </button>
          {informativaAperta && (
            <div className="wr-consensi__informativa" id="wr-consensi-informativa">
              {privacy.testo}
            </div>
          )}
        </>
      ) : (
        <a className="wr-consensi__link" href={privacy.url} target="_blank" rel="noopener noreferrer">
          {tReg('gdprLink')}
        </a>
      )}
    </div>
  ) : null;

  const consensiBlock = recordingRequired || trascrizioneChiesta ? (
    <section className="wr-consensi" aria-labelledby="wr-consensi-title">
      <h2 className="wr-consensi__title" id="wr-consensi-title">
        {recordingRequired ? t('recordingConsentTitle') : t('multitrackConsentTitle')}
      </h2>
      {recordingRequired && (
        <>
          <p className="wr-consensi__intro">
            {recordingConsentText?.trim() || t('recordingConsentIntro')}
          </p>
          <div className="form-check mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id={CAMPO_DEL_BLOCCO.recording}
              checked={recordingConsent}
              onChange={(e) => setRecordingConsent(e.target.checked)}
              aria-describedby={!recordingConsent ? MESSAGGIO_DEL_BLOCCO.recording : undefined}
            />
            <label className="form-check-label" htmlFor={CAMPO_DEL_BLOCCO.recording}>
              {tGdpr('recording')}
            </label>
          </div>
          {!recordingConsent && (
            <div id={MESSAGGIO_DEL_BLOCCO.recording} className="wr-consensi__nota">
              {t('recordingConsentRequired')}
            </div>
          )}
        </>
      )}
      {trascrizioneChiesta && (
        <div className={recordingRequired ? 'mt-3' : undefined}>
          {/* Con entrambi i consensi, quello alla traccia audio ha il suo
              titolo: e' un consenso a parte, non un dettaglio dell'altro. */}
          {recordingRequired && (
            <h3 className="wr-consensi__title">{t('multitrackConsentTitle')}</h3>
          )}
          <div className="form-check mb-0">
            <input
              className="form-check-input"
              type="checkbox"
              id={CAMPO_TRASCRIZIONE}
              checked={multitrackConsent}
              onChange={(e) => setMultitrackConsent(e.target.checked)}
              aria-describedby={`${CAMPO_TRASCRIZIONE}-nota`}
            />
            <label className="form-check-label" htmlFor={CAMPO_TRASCRIZIONE}>
              {tGdpr('multitrack')}
            </label>
          </div>
          <div id={`${CAMPO_TRASCRIZIONE}-nota`} className="wr-consensi__nota">
            {tGdpr('multitrackOptional')}
          </div>
        </div>
      )}
      {informativa}
    </section>
  ) : null;

  const chatPreviewBlock = showChatPreview ? (
    <div className="wr-chat">
      <div className="wr-chat__head">
        <span className="wr-chat__icon" aria-hidden="true">
          <Icon icon="it-comment" size="sm" />
        </span>
        <span>
          <span className="wr-chat__title">{t('chatPreviewTitle')}</span>
          <span className="wr-chat__hint">{t('chatPreviewHint')}</span>
        </span>
      </div>
      {nameValid ? (
        <div className="wr-chat__body">
          <ChatPanel
            eventSlug={event.slug}
            token={chatToken}
            displayName={trimmedName}
            isGuest={!chatToken}
            onMessaggioNuovo={ponteChat.messaggio}
            onMessaggioModificato={ponteChat.modificato}
            onMessaggioRimosso={ponteChat.rimosso}
            onScrittura={ponteChat.scrittura}
            posizione={piazzaOpen ? 'piazza' : 'sala'}
          />
        </div>
      ) : (
        <div className="wr-chat__locked">
          <Icon icon="it-lock" size="sm" className="mb-2" />
          <div>{t('chatLockedMessage')}</div>
        </div>
      )}
    </div>
  ) : null;

  const backLinkBlock = isPublished ? (
    <Link href={percorso(`/events/${event.slug}`)}>
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
  // would collide with it. The div
  // owns its own spinner+border layout, like consensiBlock.
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
            {/* Senza scaler non c'è niente in accensione: un orologio, non
                uno spinner. */}
            {warmup?.phase === 'scheduled' ? (
              <Icon icon="it-clock" size="sm" className="me-2 mt-1 flex-shrink-0" />
            ) : (
              <Spinner active small className="me-2 mt-1 flex-shrink-0" />
            )}
            <div className="flex-grow-1">
              <div className="d-flex justify-content-between align-items-baseline flex-wrap gap-2">
                <strong>
                  {warmup?.phase === 'scheduled'
                    ? t('warmup.scheduled')
                    : warmup?.phase === 'ready'
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
                {warmup?.phase === 'scheduled'
                  ? t('warmup.scheduledDetail')
                  : warmup?.phase === 'ready'
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
          className="waiting-countdown waiting-countdown--open"
          role="status"
          aria-live="assertive"
        >
          <div className="waiting-countdown__label">{t('roomOpen')}</div>
          <div className="waiting-countdown__value">{liveCountdown}</div>
        </div>
      )}
      {/* Anche in preparazione o in pausa: se nessuno porta la sala a LIVE (lo
          scaler è fermo, o non c'è), il moderatore deve poterla aprire lui.
          Non oltre la fine: l'evento non si è tenuto. */}
      {canStartManually(event.status) && !notHeld && isModerator && onStartEvent && (
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
      {canEnterLive && !ingressoConsentito ? (
        // Entrare prima che il ponte video esista significa arrivare in una
        // stanza che non c'e': si resta qui, e lo si dice. Passato il minuto
        // si torna al pulsante normale — si entra, senza pero' promettere che
        // dall'altra parte ci sia qualcuno.
        <>
          <Button color="primary" size="lg" className="fw-semibold" disabled>
            <Spinner active small className="me-2" />
            {t('roomNotReadyButton')}
          </Button>
        </>
      ) : canEnterLive ? (
        <>
          {/* Il colore e il battito non arrivano a chi non guarda lo schermo, e
              l'etichetta che cambia dentro un pulsante non a fuoco non viene
              letta: l'apertura va detta a voce, qui. */}
          <p className="visually-hidden" role="status">
            {annuncio ? t(annuncio) : ''}
          </p>
          {/* Il campo del nome sta sopra l'anteprima della fotocamera: chi
              guarda il pulsante spesso non lo vede. Il motivo lo si ripete qui
              per gli occhi; il lettore di schermo lo riceve una volta sola,
              come descrizione del pulsante. Il consenso non serve ripeterlo:
              il suo riquadro sta subito sopra. */}
          {(bloccoSpiegato === 'name' || bloccoSpiegato === 'email') && (
            <p
              className="d-flex align-items-start justify-content-center text-center mb-0"
              // Il nome mancante è una cosa da fare (ambra), l'email sbagliata
              // un errore (rosso).
              style={{ fontSize: '0.85rem', color: bloccoSpiegato === 'name' ? '#6B4400' : '#A1112E' }}
              aria-hidden="true"
            >
              <Icon icon="it-warning-circle" size="xs" className="me-1 mt-1 flex-shrink-0" style={{ fill: 'currentColor' }} />
              <span>{bloccoSpiegato === 'name' ? t('nameRequiredToEnter') : t('emailInvalid')}</span>
            </p>
          )}
          {/* Premibile anche a modulo incompleto: premerlo dice cosa manca e
              porta sul campo. Resta spento solo cio' che non dipende dalla
              persona — la sala che si prepara, l'ora d'apertura. */}
          {/* Quando si può entrare davvero (sala aperta, modulo a posto) il
              pulsante lo dice da solo: verde, con un alone che respira, un
              riflesso che passa e la freccia che indica. Il richiamo sta su
              uno strato suo (.wr-cta::after), così l'anello di focus da
              tastiera resta visibile. */}
          <div className={`wr-cta${canEnter ? ' wr-cta--go' : ''}`}>
            <Button
              color={canEnter ? 'success' : 'primary'}
              size="lg"
              className="fw-semibold wr-cta__btn"
              onClick={handleEnterLive}
              aria-describedby={bloccoSpiegato ? MESSAGGIO_DEL_BLOCCO[bloccoSpiegato] : undefined}
            >
              <Icon icon="it-video" size="sm" color="white" className="me-2" />
              {evidenziaCta ? t('roomJustOpened') : t('joinNowBtn')}
              {canEnter && (
                <span className="wr-cta__arrow" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              )}
            </Button>
          </div>
        </>
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
          <Icon icon="it-restore" size="sm" color="success" className="me-2" />
          {t('watchCatchup')}
        </Button>
      )}
      {/* Uscita esplicita: nella sala d'attesa non si è "intrappolati" —
          soprattutto durante il warm-up, quando la CTA è disabilitata. Non
          in PUBLISHED: lì c'è già il backLinkBlock ("Indietro") più in basso,
          verso la stessa pagina evento — evitiamo il doppione. */}
      {exitHref && !isEnded && !isPublished && (
        <Link
          href={percorso(exitHref)}
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

  // `hostOwnsEntry` spegne la chrome interna della lobby (onboarding, top bar,
  // pannello dispositivi). Senza, il gioco ne mostra una propria: in italiano
  // fisso — su 24 lingue —, con un nome che non torna mai nello stato React
  // (quindi l'ingresso si blocca in silenzio) e un ingresso che scavalca il
  // gate LIVE, facendo entrare un moderatore in una sala mai avviata.
  // ── Il riepilogo: quando, chi organizza, chi conduce e chi interviene, la
  // registrazione, di cosa si parla; e i link da condividere.
  const durataMin = Math.max(0, Math.round((endsAtMs - startsAtMs) / 60_000));
  const ore = Math.floor(durataMin / 60);
  const minuti = durataMin % 60;
  const durataTesto =
    ore === 0
      ? t('durationMinutes', { minutes: minuti })
      : minuti === 0
        ? t('durationHours', { hours: ore })
        : t('durationHoursMinutes', { hours: ore, minutes: minuti });
  const enti = event.riepilogo?.enti ?? [];
  const persone = event.riepilogo?.persone ?? [];
  const conduzione = persone.filter((p) => p.role !== 'speaker');
  const relatori = persone.filter((p) => p.role === 'speaker');
  const nomiPersone = (lista: PersonaPubblica[]) =>
    lista.map((p) => (p.organization ? `${p.name} (${p.organization})` : p.name)).join(', ');
  const descrizione = event.riepilogo?.descrizione?.trim() || null;
  // La bacheca della piazza: le stesse informazioni del riepilogo.
  const bacheca: DatiBacheca = {
    titolo: event.title,
    voci: [
      { etichetta: t('summaryWhen'), valore: `${dateLabel} · ${startTimeLabel} – ${endTimeLabel} (${durataTesto})` },
      ...(enti.length > 0 || event.organizerName
        ? [{ etichetta: te('detail.organizedBy'), valore: enti.length > 0 ? enti.map((e) => e.name).join(', ') : (event.organizerName ?? '') }]
        : []),
      ...(conduzione.length > 0 ? [{ etichetta: te('detail.peopleModerators'), valore: nomiPersone(conduzione) }] : []),
      ...(relatori.length > 0 || event.speakers
        ? [{ etichetta: te('detail.speakers'), valore: relatori.length > 0 ? nomiPersone(relatori) : (event.speakers ?? '') }]
        : []),
    ],
    descrizione,
  };
  // La galleria della piazza espone le immagini dell'evento e i loghi di chi
  // lo organizza.
  const mostra: MostraGalleria = {
    immagini: [event.coverImageUrl, event.imageUrl]
      .filter((src, i, tutte): src is string => !!src && tutte.indexOf(src) === i)
      .map((src) => ({ src, alt: event.title })),
    loghi: enti
      .filter((e): e is EntePubblico & { logoUrl: string } => !!e.logoUrl)
      .map((e) => ({ src: e.logoUrl, alt: e.name })),
  };

  const piazzaStage = piazzaOpen ? (
    <PhaserLobbyBoundary onError={goClassic}>
      {/* La scena è raggiungibile col Tab, non solo col mouse: il gioco cede i
          tasti a qualunque controllo a fuoco, quindi dopo un Tab verso i
          pulsanti ci si deve poter tornare da tastiera. */}
      <div
        className="wr-piazza-stage"
        ref={gameDialogRef}
        tabIndex={0}
        role="application"
        aria-label={t('gardenGateHint')}
      >
        <PhaserLobby
          hostOwnsEntry
          eventSlug={event.slug}
          accessToken={chatToken}
          displayName={trimmedName}
          status={event.status}
          startsAtMs={startsAtMs}
          isHost={isModerator}
          salaPronta={salaPronta}
          ponteChat={ponteChat}
          bacheca={bacheca}
          mostra={mostra}
          onEnterLive={handleGameEnter}
          onExitClassic={goClassic}
        />
        <div className="wr-piazza-stage__bar">
          <button
            type="button"
            className="wr-piazza-btn wr-piazza-btn--exit"
            onClick={closePiazza}
          >
            <Icon icon="it-arrow-left" size="xs" className="me-1" />
            {t('backToWaitingRoom')}
          </button>
          {/* L'uscita di sicurezza per chi non regge l'animazione. Stava nella
              top bar del gioco, che `hostOwnsEntry` spegne: senza questo
              pulsante non resterebbe alcun modo di scegliere la versione
              accessibile — e la scelta va RICORDATA, non solo applicata. */}
          <button type="button" className="wr-piazza-btn" onClick={goClassic}>
            {t('classicVersion')}
          </button>
          {/* Chi e' nella piazza non vede la colonna dei controlli: se il
              cancello e' chiuso, qui dentro non c'e' altra strada. Finche' la
              stanza non risulta allestita il cordone resta — non si promette
              cio' che non si sa — ma scaduta l'attesa si offre lo stesso
              passaggio che ha chi e' rimasto nella sala classica. */}
          {isLive && !salaPronta && (
            <p className="wr-piazza-hint mb-0">{t('roomNotReadyButton')}</p>
          )}
          {/* Premibile anche a modulo incompleto, come «Entra» nella colonna:
              premerlo porta sul campo che manca. */}
          {isLive && !salaPronta && ingressoConsentito && (
            <button
              type="button"
              className="wr-piazza-btn"
              onClick={handleEnterLive}
              aria-describedby={bloccoSpiegato ? MESSAGGIO_DEL_BLOCCO[bloccoSpiegato] : undefined}
            >
              {t('enterAnyway')}
            </button>
          )}
          {/* Senza nome il cancello respinge: invece di invitare a camminarci
              dentro, qui sopra la scena — dove la persona sta guardando — si
              dice cosa manca. */}
          {isLive && salaPronta && (
            <p className="wr-piazza-hint mb-0">
              {bloccoSpiegato === 'name' ? t('nameRequiredToEnter') : t('gardenGateHint')}
            </p>
          )}
        </div>
      </div>
    </PhaserLobbyBoundary>
  ) : null;

  // La colonna laterale: la chat dell'evento a tutta altezza e, sotto, la
  // piazza come POSTO ALTERNATIVO dove aspettare (quando l'evento la prevede):
  // non un passaggio da fare prima di entrare.
  const piazzaCard = canPlay && !gameOpen ? (
    <button type="button" className="wr-piazza-card" ref={inviteRef} onClick={() => setGameOpen(true)}>
      <span className="wr-piazza-card__art" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="56" height="56">
          <rect x="2" y="2" width="60" height="60" rx="16" fill="#e3f0fc" />
          <path d="M8 46c10-6 18-6 24 0s16 6 24 0v12H8z" fill="#bfe3d0" />
          <circle cx="18" cy="24" r="7" fill="#66b98f" />
          <rect x="17" y="30" width="2" height="8" fill="#5a7d6a" />
          <circle cx="46" cy="22" r="6" fill="#66b98f" />
          <rect x="45" y="27" width="2" height="8" fill="#5a7d6a" />
          <circle cx="32" cy="38" r="5" fill="#0066cc" />
          <circle cx="32" cy="31" r="3.2" fill="#ffcc80" />
          <circle cx="40" cy="44" r="4" fill="#d9364f" />
          <circle cx="40" cy="38.5" r="2.6" fill="#ffcc80" />
        </svg>
      </span>
      <span className="wr-piazza-card__text">
        <span className="wr-piazza-card__kicker">{t('piazzaAltKicker')}</span>
        <span className="wr-piazza-card__title">{t('enterGardenTitle')}</span>
        <span className="wr-piazza-card__hint">{t('enterGardenHint')}</span>
      </span>
      <span className="wr-piazza-card__go" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
             strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      </span>
    </button>
  ) : null;

  const asideBox = chatPreviewBlock || piazzaCard ? (
    <aside className="wr-aside" aria-labelledby="wr-aside-title">
      <h2 className="wr-aside__title" id="wr-aside-title">{t('whileYouWait')}</h2>
      {chatPreviewBlock}
      {piazzaCard}
    </aside>
  ) : null;

  const statusBadge = isLive ? (
    <span className="wr-status wr-status--live">
      <span className="wr-status__dot" aria-hidden="true" />
      {t('eventLive')}
    </span>
  ) : isEnded ? (
    <span className="wr-status wr-status--ended">
      {notHeld ? t('notHeldBadge') : t('endedTitle')}
    </span>
  ) : null;

  // Chi c'è: in diretta (solo a evento avviato) e in sala d'attesa. Non è una
  // regione che si annuncia: cambierebbe ogni quindici secondi.
  const presenzeBlock = !isEnded && presenze ? (
    <div className="wr-presence" aria-label={t('presenceTitle')} role="group">
      {isLive && (
        <span className="wr-presence__item wr-presence__item--live" key={`d-${presenze.inDiretta}`}>
          <span className="wr-presence__dot" aria-hidden="true" />
          {t('presenceLive', { count: presenze.inDiretta })}
        </span>
      )}
      <span className="wr-presence__item" key={`a-${presenze.inAttesa}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        {t('presenceWaiting', { count: presenze.inAttesa })}
      </span>
    </div>
  ) : null;


  const fatto = (chiave: string, icona: ReactNode, etichetta: string, valore: ReactNode, sotto?: ReactNode) => (
    <li className="wr-fact" key={chiave}>
      <span className="wr-fact__icon" aria-hidden="true">{icona}</span>
      <span className="wr-fact__body">
        <span className="wr-fact__label">{etichetta}</span>
        <span className="wr-fact__value">{valore}</span>
        {sotto && <span className="wr-fact__sub">{sotto}</span>}
      </span>
    </li>
  );
  const svg = (children: ReactNode) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
         strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
  const fatti: ReactNode[] = [
    fatto(
      'quando',
      svg(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></>),
      t('summaryWhen'),
      `${dateLabel} · ${startTimeLabel} – ${endTimeLabel}`,
      durataTesto,
    ),
  ];
  if (enti.length > 0 || event.organizerName) {
    fatti.push(
      fatto(
        'enti',
        svg(<><path d="M3 21h18" /><path d="M5 21V8l7-5 7 5v13" /><path d="M9 21v-6h6v6" /></>),
        te('detail.organizedBy'),
        enti.length > 0 ? enti.map((e) => e.name).join(', ') : event.organizerName,
      ),
    );
  }
  // Solo chi l'organizzazione ha scelto di pubblicare, come sulla pagina
  // dell'evento: il nome del moderatore non pubblicato resta riservato.
  if (conduzione.length > 0) {
    fatti.push(
      fatto(
        'conduzione',
        svg(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>),
        te('detail.peopleModerators'),
        nomiPersone(conduzione),
      ),
    );
  }
  if (relatori.length > 0 || event.speakers) {
    fatti.push(
      fatto(
        'relatori',
        svg(<><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="22" /></>),
        te('detail.speakers'),
        relatori.length > 0 ? nomiPersone(relatori) : event.speakers,
      ),
    );
  }
  // La registrazione è un'informazione, non un allarme.
  if (event.recordingEnabled && !isEnded) {
    fatti.push(
      fatto(
        'registrazione',
        <span className="wr-fact__rec" />,
        t('summaryRecording'),
        recordingListenOnly ? tGdpr('recordingNotice') : t('recordingNotice'),
      ),
    );
  }

  const linkPaginaEvento =
    condivisione?.hasPublicPage && eventType !== 'INSTANT' ? (
      <Link href={percorso(`/events/${event.slug}`)} className="wr-link">
        {svg(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>)}
        {t('eventPageLink')}
      </Link>
    ) : null;

  const riepilogoBlock = (
    <section className="wr-summary" aria-labelledby="wr-summary-title">
      <h2 className="wr-section-title" id="wr-summary-title">{t('summaryTitle')}</h2>
      <ul className="wr-facts">{fatti}</ul>
      {descrizione && (
        <div className="wr-about">
          <div
            ref={descrizioneRef}
            className={`wr-about__text${descrizioneAperta ? '' : ' is-clamped'}${descrizioneLunga ? '' : ' is-short'}`}
            id="wr-about-text"
          >
            <div ref={descrizioneContenutoRef}>
              <MarkdownRenderer content={descrizione} />
            </div>
          </div>
          {(descrizioneLunga || descrizioneAperta) && (
          <button
            type="button"
            className="wr-about__toggle"
            aria-expanded={descrizioneAperta}
            aria-controls="wr-about-text"
            onClick={() => setDescrizioneAperta((v) => !v)}
          >
            {descrizioneAperta ? t('readLess') : t('readMore')}
          </button>
          )}
        </div>
      )}
      {(linkPaginaEvento || condivisione) && (
        <div className="wr-summary__links">
          {linkPaginaEvento}
          {condivisione && !isEnded && (
            <span className="wr-share">
              <LiveShareButton
                slug={event.slug}
                locale={condivisione.locale}
                moderatorToken={condivisione.moderatorToken}
                hasPublicPage={condivisione.hasPublicPage}
                hasCallLink={condivisione.hasCallLink}
              />
            </span>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div
      className={piazzaOpen ? 'waiting-shell waiting-shell--piazza' : 'waiting-shell'}
      // Una REGIONE con un nome, non un dialogo.
      //
      // `dialog` (con o senza `aria-modal`) promette che ciò che sta sotto è
      // fuori gioco. Qui non lo è: il guscio copre la finestra, ma
      // l'intestazione e il piè di pagina del sito restano raggiungibili col
      // Tab, e stanno FUORI da questo componente — da qui non si possono
      // rendere inerti. Annunciamo quello che questa cosa è: una parte di
      // pagina, con un nome. Esc la chiude comunque.
      {...(piazzaOpen
        ? { role: 'region' as const, 'aria-label': t('gardenDialogLabel') }
        : {})}
    >
      {/* Fratello, non sostituto: `{false}` occupa comunque la sua posizione
          fra i figli, quindi il container qui sotto resta lo STESSO nodo React
          aprendo e chiudendo la piazza — niente smontaggi, niente fotocamera
          riacquisita, niente bozze perse. */}
      {piazzaStage}
      <div className="container py-4 py-md-5 wr-page">
        <div className="row g-4 justify-content-center">
          {/* Nella piazza la colonna con la chat viene prima, nel DOM e non
              solo a vista, così l'ordine del Tab segue quello che si vede.
              Le chiavi fanno spostare le due colonne senza smontarle: la
              fotocamera e la bozza in chat restano. */}
          {inOrdine([
          <div key="card" className={asideBox ? 'col-lg-7' : 'col-lg-8 col-xl-7'}>
            <Card
              className={`waiting-card wr-card shadow-sm border-0${heroUrl ? '' : ' waiting-card--plain'}`}
            >
              {/* La fascia c'e' solo se c'e' un'immagine da mostrare. */}
              {heroUrl && (
                <div
                  className="waiting-hero"
                  style={{ background: `url("${heroUrl}") center/cover no-repeat` }}
                >
                  {statusBadge && <div className="waiting-hero__badge">{statusBadge}</div>}
                </div>
              )}

              <CardBody className="p-4 p-md-5">
                {!heroUrl && statusBadge && <div className="mb-3 wr-reveal">{statusBadge}</div>}
                <EventTitle
                  title={event.title}
                  kickerEnabled={event.parseTitleKicker ?? false}
                  as="h1"
                  className="h3 fw-bold mb-3 wr-reveal"
                  style={{ color: 'var(--app-text)' }}
                />

                {presenzeBlock && <div className="mb-3 wr-reveal">{presenzeBlock}</div>}

                {isPublished && countdown && (
                  <div className={`waiting-countdown mb-4${pulseCountdown ? ' waiting-countdown--pulse' : ''}`}>
                    <div className="waiting-countdown__label">{t('startsIn')}</div>
                    <div className="waiting-countdown__value">{countdown}</div>
                  </div>
                )}

                {/* "Sta per iniziare, attendi l'organizzatore": non al moderatore —
                    l'organizzatore è lui, e ha accanto il bottone "Avvia evento". */}
                {isPublished && startingSoon && !isModerator && (
                  <div className="wr-soon mb-4" role="status" aria-live="polite">
                    <Spinner active small className="me-2" />
                    <span className="fw-semibold">{t('startingSoon')}</span>
                  </div>
                )}

                {(isWarmingUp || (isLive && jvbReady === false)) && (
                  <div className="mb-4">{statusBanners}</div>
                )}

                <div className="mb-4 wr-reveal wr-summary-wrap">{riepilogoBlock}</div>

                {/* Da http:// il browser nega microfono e videocamera: lo si dice
                    qui, con l'indirizzo sicuro, invece di una prova dei
                    dispositivi che chiede un permesso impossibile. */}
                {!isEnded && <InsecureContextNotice className="mb-3" />}
                {!isEnded && (
                  <div
                    className={`wr-name-field mb-3${
                      nomeNoto && !nameValid ? ' wr-name-field--empty' : ''
                    }${nomeSegnalato ? ' wr-name-field--insist' : ''}`}
                  >
                    {nameField}
                  </div>
                )}
                {/* La foto al posto delle iniziali: solo per chi ha un'email
                    dietro al token (lo dice il server). */}
                {!isEnded && chatToken && (
                  <ProfilePhotoField eventSlug={event.slug} token={chatToken} name={name} />
                )}
                {/* Email: solo per gli ospiti (i registrati l'hanno già data,
                    per moderatori/speaker è irrilevante). */}
                {!isEnded && isGuest && (
                  <div className="mb-4 wr-email-field">{emailField}</div>
                )}
                {!isEnded && <div className="mb-4">{deviceCheckField}</div>}

                {isPublished && !notHeld && event.waitingRoomAudioUrl && (
                  <div className="mb-4 d-flex justify-content-center">
                    <AudioPlayer audioUrl={event.waitingRoomAudioUrl} />
                  </div>
                )}

                {notHeld ? (
                  <div className="mb-3" role="status">
                    <h2 className="h5 fw-semibold mb-1" style={{ color: 'var(--app-text)' }}>
                      {t('notHeldTitle')}
                    </h2>
                    <p className="text-muted mb-0" style={{ fontSize: '0.9rem' }}>
                      {t('notHeldDetail')}
                    </p>
                  </div>
                ) : isEnded ? (
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
                    {consensiBlock && <div className="mb-3">{consensiBlock}</div>}
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
                {!isEnded && classicView && (
                  <div className="text-center mb-3">
                    <Button
                      color="primary"
                      outline
                      size="sm"
                      className="fw-semibold"
                      innerRef={classicToggleRef}
                      onClick={() => toggleClassic(false)}
                    >
                      <Icon icon="it-arrow-left" size="xs" className="me-1" />
                      {t('backToGarden')}
                    </Button>
                  </div>
                )}

                {aiNoticeBlock && <div className="mb-3">{aiNoticeBlock}</div>}
                {captionsNoticeBlock && <div className="mb-3">{captionsNoticeBlock}</div>}
                <div className="mb-3">{netiquetteBlock}</div>
                {backLinkBlock && <div className="text-center">{backLinkBlock}</div>}

                {isPublished && !notHeld && !isModerator && (
                  <p className="text-center text-muted mt-3 mb-0" style={{ fontSize: '0.8rem' }}>
                    <Icon icon="it-refresh" size="xs" className="me-1" />
                    {t('autoRefreshHint')}
                  </p>
                )}
              </CardBody>
            </Card>
          </div>,
          asideBox ? <div key="aside" className="col-lg-5">{asideBox}</div> : null,
          ], piazzaOpen)}
        </div>
      </div>
    </div>
  );
}
