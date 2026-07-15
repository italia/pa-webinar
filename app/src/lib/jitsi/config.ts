/**
 * Jitsi IFrame API configuration.
 *
 * We show Jitsi's native toolbar for essential controls (mic, camera,
 * screen share, etc.) while keeping our custom wrapper for moderator
 * features (recording, end event) and the Q&A panel.
 *
 * Chat and reactions are handled by custom components in the app sidebar
 * and as a floating overlay, so they are excluded from the Jitsi toolbar.
 *
 * NOTE: Theme (customTheme), watermark, and branding settings are applied
 * server-side via Jitsi's _custom_config_js and _custom_interface_config_js
 * in the Helm values — NOT here. The IFrame API ignores customTheme and
 * dynamicBrandingUrl when passed via configOverwrite.
 */

/**
 * Toolbars carry NO native 'hangup' — for ANY role. Jitsi's own hangup
 * fires `videoConferenceLeft` without going through our app, so the
 * network-resilience path used to mistake it for a drop and reconnect the
 * user in a loop. Instead every exit goes through our top-bar "Esci dalla
 * sala" button: participants leave for themselves; moderators get a prompt
 * ("Esci solo tu" vs "Termina per tutti"). See live-event-client
 * handleLeaveRoom / handleReadyToClose.
 *
 * 'chat' excluded: we use a custom ChatPanel in the sidebar.
 * 'reactions' excluded: we use a custom ReactionBar overlay.
 */
export const baseToolbarButtons = [
  'microphone',
  'camera',
  'select-background',
  'desktop',
  'fullscreen',
  'filmstrip',
  'tileview',
  'settings',
  'raisehand',
];

export const moderatorToolbarButtons = [
  ...baseToolbarButtons,
  // NO 'hangup' — see baseToolbarButtons: exit is our app button so the
  // moderator gets the "Esci solo tu / Termina per tutti" prompt.
  'mute-everyone',
  'security',
  'participants-pane',
  // NB: 'whiteboard' is NOT here — it's per-event opt-in (Event.whiteboardEnabled)
  // and appended conditionally for moderators on desktop in JitsiRoom. Jitsi
  // additionally feature-gates it on config.whiteboard.enabled (set server-side,
  // test only), so it stays hidden on prod even when an event opted in.
];

/**
 * Trimmed participant toolbar for mobile (<768px). Drops tile/filmstrip/
 * fullscreen/select-background — non-technical first-timers on a shared
 * link get lost otherwise. Settings stays because it contains the
 * device chooser which is the most-asked-for control on mobile.
 */
// Mobile: no 'desktop' — iOS Safari + most Android browsers don't
// support getDisplayMedia() inside an iframe, so the button would
// surface a misleading error. Feedback on the Friday caffettino
// confirmed this (several users on mobile couldn't share screen).
export const mobileBaseToolbarButtons = [
  'microphone',
  'camera',
  'raisehand',
  'settings',
];

/**
 * Moderator mobile toolbar: same trim as participants plus the
 * participants-pane button (needed to manage the room on small screens).
 * No native 'hangup' — exit goes through the app button (see
 * baseToolbarButtons) so the moderator gets the leave/end-for-all prompt.
 */
export const mobileModeratorToolbarButtons = [
  ...mobileBaseToolbarButtons,
  'participants-pane',
];

/**
 * Config overrides passed as `configOverwrite`.
 * Toolbar buttons are merged at instantiation time based on role.
 */
export const jitsiConfigOverwrite = {
  // Start muted but users CAN unmute
  startWithAudioMuted: true,
  startWithVideoMuted: true,
  startSilent: false,
  disableInitialGUM: false,

  prejoinConfig: { enabled: false },
  disableDeepLinking: true,
  hideConferenceSubject: true,
  hideConferenceTimer: false,
  disableProfile: true,

  // Self-view "hide" is a one-way trap in our embed (F10): once a user hides
  // their own thumbnail there's no in-UI way to bring it back. Disable the
  // control entirely — Jitsi gates BOTH the local-tile "Hide self view" menu
  // entry and the Settings checkbox on this flag, so nobody can get stuck.
  disableSelfViewSettings: true,

  disableChat: false,

  // NOTE: `disableKick: true` is the safe default — prevents participants
  // from even attempting a kick (Jitsi would reject it server-side, but
  // showing the button confuses users). JitsiRoom flips this to `false`
  // at instantiation when `role === 'moderator'` so the participants-pane
  // "rimuovi utente" action actually dispatches. `disableGrantModerator`
  // stays `true` globally: only the primary moderator (via JWT) should
  // grant, never via UI.
  remoteVideoMenu: {
    disabled: false,
    disableKick: true,
    disableGrantModerator: true,
    disablePrivateChat: false,
  },

  conferenceInfo: {
    alwaysVisible: [],
    autoHide: [],
  },

  enableWelcomePage: false,
  enableClosePage: false,
  disableInviteFunctions: true,

  // Overridden per role at instantiation
  toolbarButtons: baseToolbarButtons as string[],

  notifications: [] as string[],
  disableReactions: true,

  // F8 — keep a raised hand UP until the user lowers it or a moderator handles
  // it. Stock Jitsi auto-lowers the hand the moment the participant becomes the
  // dominant speaker (starts talking), which testers found confusing ("ho alzato
  // la mano e sparisce appena parlo"). MUST be the NESTED form on our served
  // build (jitsi/web stable 10741): the selector reads only
  // config.raisedHands?.disableRemoveRaisedHandOnFocus — the legacy TOP-LEVEL
  // `disableRemoveRaisedHandOnFocus` is deprecated and a silent no-op there, so
  // do NOT flatten this key.
  raisedHands: {
    disableRemoveRaisedHandOnFocus: true,
  },

  breakoutRooms: {
    hideAddRoomButton: true,
    hideAutoAssignButton: true,
    hideJoinRoomButton: true,
  },

  p2p: { enabled: false },
  enableFileSharing: false,
  enableLobbyChat: false,
  // Gravatar disabled separately — we proxy via /api/avatar.
  // disableThirdPartyRequests blocked JWT avatar data URIs in some Jitsi builds.
  gravatar: { disabled: true },
  brandingRoomAlias: null,

  // ── Video quality tuning ─────────────────────────────────────
  // Default Jitsi reserves HD only to ~2 dominant speakers and drops
  // everyone else to 180p, which looks compressed on a community call
  // where 8-10 people all have their camera on. Raise the ceiling so
  // all active senders stay at SD/HD — 10 senders × 1.5 Mbps is still
  // well within any decent uplink and fits our JVB sizing (≤50 senders
  // per pod). Adjust `maxFullResolutionParticipants` downward on
  // webinar-style events if needed.
  constraints: {
    video: {
      height: { ideal: 720, max: 720, min: 240 },
    },
  },
  maxFullResolutionParticipants: 25,
  resolution: 720,

  // ── Audio processing (esplicito, non affidato ai default del build) ──
  // Webinar = parlato su speaker di laptop: AEC/NS/AGC ON evitano eco e
  // sbalzi di volume. enableTalkWhileMuted ricorda "sei mutato" a chi parla
  // da mutato (errore tipico dei partecipanti non tecnici).
  // enableNoisyMicDetection è OFF: il prompt "mic disturbato" spingeva gli
  // utenti verso il toggle di noise-suppression (rotto lato served-config),
  // più dannoso che utile.
  disableAEC: false,
  disableNS: false,
  disableAGC: false,
  enableNoisyMicDetection: false,
  enableTalkWhileMuted: true,
};

/**
 * Interface config overrides passed as `interfaceConfigOverwrite`.
 */
export const jitsiInterfaceConfigOverwrite = {
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  BRAND_WATERMARK_LINK: '',
  JITSI_WATERMARK_LINK: '',
  SHOW_POWERED_BY: false,
  PROVIDER_NAME: '',
  APP_NAME: 'PA Webinar',
  NATIVE_APP_NAME: 'PA Webinar',

  TOOLBAR_BUTTONS: baseToolbarButtons as string[],
  // Keep the toolbar always visible. Auto-hide at 4s surprised users
  // on the Friday caffettino — some saw it only as a half-peek when
  // the pointer was near the bottom and couldn't find mic/cam.
  TOOLBAR_ALWAYS_VISIBLE: true,
  INITIAL_TOOLBAR_TIMEOUT: 20000,
  TOOLBAR_TIMEOUT: 20000,

  HIDE_INVITE_MORE_HEADER: true,
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
  MOBILE_APP_PROMO: false,
  SHOW_CHROME_EXTENSION_BANNER: false,
  DISABLE_DOMINANT_SPEAKER_INDICATOR: false,
  DISABLE_VIDEO_BACKGROUND: false,
  FILM_STRIP_MAX_HEIGHT: 120,
  VERTICAL_FILMSTRIP: true,
} as const;

/**
 * Participant feature flags set via JWT context.
 */
export interface JitsiJwtFeatures {
  recording: boolean;
  livestreaming: boolean;
  'screen-sharing': boolean;
  'outbound-call': boolean;
}

export const participantFeatures: JitsiJwtFeatures = {
  recording: false,
  livestreaming: false,
  'screen-sharing': true,
  'outbound-call': false,
};

export const moderatorFeatures: JitsiJwtFeatures = {
  recording: true,
  livestreaming: false,
  'screen-sharing': true,
  'outbound-call': false,
};

/**
 * Speaker ("relatore"): full AV rights like a moderator, but cannot
 * record, kick or mute-everyone. Mapped to Jitsi's participant role
 * (moderator:false) so Jitsi's internal permissions also deny mod-only
 * actions — we don't rely on just hiding buttons.
 */
export const speakerFeatures: JitsiJwtFeatures = {
  recording: false,
  livestreaming: false,
  'screen-sharing': true,
  'outbound-call': false,
};

/**
 * Speaker toolbar: same as base participant toolbar. No hangup/
 * mute-everyone/security/participants-pane — those are moderator-only.
 * Kept as a named export for clarity and to make i18n/tests explicit.
 */
export const speakerToolbarButtons = baseToolbarButtons;

/**
 * Instant call: participants get full AV (mic, camera, screen share)
 * but NOT recording — only the creator (moderator) can record.
 */
export const instantCallToolbarButtons = [
  'microphone',
  'camera',
  'select-background',
  'desktop',
  'fullscreen',
  'filmstrip',
  'tileview',
  'settings',
  'raisehand',
  'participants-pane',
  'shareaudio',
];

export const instantCallModeratorToolbarButtons = [
  ...instantCallToolbarButtons,
  // NO 'hangup' — consistent with moderatorToolbarButtons: exit is the app
  // button so the host gets the "Esci solo tu / Termina per tutti" prompt.
  'mute-everyone',
  'security',
];

export const instantCallConfigOverwrite = {
  ...jitsiConfigOverwrite,
  enableFileSharing: true,
  disableChat: false,
  startWithAudioMuted: true,
  startWithVideoMuted: true,
};

// ── Video / audio quality presets ──────────────────────────────────
//
// Admin-configurable quality (SiteSetting.videoQuality, overridable per
// event via Event.videoQuality). Each preset maps to a set of Jitsi
// IFrame `configOverwrite` keys that ACTUALLY change the stream:
//   • resolution + constraints.video.height → captured/sent resolution
//   • videoQuality.maxBitratesVideo          → per-layer bitrate caps (bps)
//   • maxFullResolutionParticipants          → how many senders keep full-res
//   • channelLastN                           → how many remote videos received (-1 = all)
//   • enableLayerSuspension                  → drop unused simulcast layers (saves uplink)
//   • audioQuality.opusMaxAverageBitrate + stereo + enableOpusRed → audio fidelity
//
// `maxHeight` is ALSO applied at runtime via
// `executeCommand('setVideoQuality', maxHeight)` on join — that command is
// the most reliable lever across Jitsi builds, so quality changes take
// effect even if a given build ignores some configOverwrite keys.
//
// Note: there is no true "lossless" in WebRTC (VP8/VP9/AV1 + Opus are lossy);
// MAX is the closest to a no-perceived-loss experience (1080p, high bitrate,
// 510 kbps stereo Opus). Echo cancellation / noise suppression are kept ON in
// every preset to avoid regressions on laptop speakers.
export type VideoQualityPreset = 'SAVE_DATA' | 'BALANCED' | 'HIGH' | 'MAX';

export const VIDEO_QUALITY_PRESETS = ['SAVE_DATA', 'BALANCED', 'HIGH', 'MAX'] as const;

/** Prod default: best perceived quality at 720p with a hard bitrate cap —
 *  favours quality without maxing bandwidth (the single-JVB-friendly sweet
 *  spot). Changeable in admin and per event. */
export const DEFAULT_VIDEO_QUALITY_PRESET: VideoQualityPreset = 'HIGH';

interface VideoQualityDefinition {
  /** Sent/received resolution ceiling (px height). Used for setVideoQuality. */
  maxHeight: number;
  configOverwrite: {
    resolution: number;
    constraints: { video: { height: { ideal: number; max: number; min: number } } };
    maxFullResolutionParticipants: number;
    channelLastN: number;
    enableLayerSuspension: boolean;
    videoQuality: {
      maxBitratesVideo: { low: number; standard: number; high: number };
      // Preferenza codec video. VP9 è ~30-50% più efficiente di VP8 (default
      // build): immagine più nitida a parità di bitrate cap — vale doppio sul
      // piano relay-only (ogni bit rimbalza su coturn). VP8 come fallback per
      // device/browser che non negoziano VP9. Su SAVE_DATA preferiamo VP8
      // (encode più leggero su device deboli).
      codecPreferenceOrder: string[];
    };
    audioQuality: { opusMaxAverageBitrate: number };
    stereo: boolean;
    enableOpusRed: boolean;
    // Framerate dello screenshare. Detail-first (F13): i preset di uso comune
    // (SAVE_DATA/BALANCED/HIGH) stanno a max 5fps così l'encoder spende il
    // budget di bitrate su pochi frame NITIDI invece di spalmarlo su ~30fps
    // morbidi — il reclamo era "screenshare sgranato" su slide/documenti.
    // Solo MAX tiene un max più alto per le rare demo con video in condivisione.
    desktopSharingFrameRate: { min: number; max: number };
  };
}

const QUALITY_DEFINITIONS: Record<VideoQualityPreset, VideoQualityDefinition> = {
  SAVE_DATA: {
    maxHeight: 360,
    configOverwrite: {
      resolution: 360,
      constraints: { video: { height: { ideal: 360, max: 360, min: 180 } } },
      maxFullResolutionParticipants: 5,
      channelLastN: 6,
      enableLayerSuspension: true,
      videoQuality: {
        maxBitratesVideo: { low: 120_000, standard: 300_000, high: 600_000 },
        codecPreferenceOrder: ['VP8', 'VP9'], // VP8 first: encode leggero su device deboli
      },
      audioQuality: { opusMaxAverageBitrate: 24_000 },
      stereo: false,
      enableOpusRed: false,
      desktopSharingFrameRate: { min: 5, max: 5 },
    },
  },
  BALANCED: {
    maxHeight: 540,
    configOverwrite: {
      resolution: 540,
      constraints: { video: { height: { ideal: 540, max: 540, min: 180 } } },
      maxFullResolutionParticipants: 10,
      channelLastN: 20,
      enableLayerSuspension: true,
      videoQuality: {
        maxBitratesVideo: { low: 150_000, standard: 500_000, high: 1_000_000 },
        codecPreferenceOrder: ['VP9', 'VP8'],
      },
      audioQuality: { opusMaxAverageBitrate: 48_000 },
      stereo: false,
      enableOpusRed: false,
      desktopSharingFrameRate: { min: 5, max: 5 },
    },
  },
  HIGH: {
    maxHeight: 720,
    configOverwrite: {
      resolution: 720,
      // min abbassato a 180: sotto vincolo di banda l'uplink degrada al layer
      // basso invece di freezare (il floor 360 prima poteva bloccarsi).
      constraints: { video: { height: { ideal: 720, max: 720, min: 180 } } },
      maxFullResolutionParticipants: 25,
      channelLastN: -1,
      // Still suspend layers nobody is watching — keeps "favour quality" from
      // turning into "always max uplink" when a sender is off-screen.
      enableLayerSuspension: true,
      videoQuality: {
        maxBitratesVideo: { low: 200_000, standard: 700_000, high: 2_200_000 },
        codecPreferenceOrder: ['VP9', 'VP8'],
      },
      audioQuality: { opusMaxAverageBitrate: 96_000 },
      stereo: false,
      // OFF: RED (redundant audio) a 96kbps mono contribuisce a eco/raddoppio
      // della voce; la served config.js lo tiene già a false e il nostro preset
      // lo riaccendeva. Allineato. (MAX lo lascia ON: chiamate piccole, fedeltà
      // prima della banda.)
      enableOpusRed: false,
      desktopSharingFrameRate: { min: 5, max: 5 },
    },
  },
  MAX: {
    maxHeight: 1080,
    configOverwrite: {
      resolution: 1080,
      constraints: { video: { height: { ideal: 1080, max: 1080, min: 240 } } },
      maxFullResolutionParticipants: 25,
      channelLastN: -1,
      // Keep every layer: this preset is for small, high-stakes calls where
      // fidelity beats bandwidth thrift.
      enableLayerSuspension: false,
      videoQuality: {
        maxBitratesVideo: { low: 300_000, standard: 1_200_000, high: 4_000_000 },
        codecPreferenceOrder: ['VP9', 'VP8'],
      },
      audioQuality: { opusMaxAverageBitrate: 510_000 },
      stereo: true,
      enableOpusRed: true,
      desktopSharingFrameRate: { min: 5, max: 30 },
    },
  },
};

function normalizeQualityPreset(preset?: string | null): VideoQualityPreset {
  return preset && (VIDEO_QUALITY_PRESETS as readonly string[]).includes(preset)
    ? (preset as VideoQualityPreset)
    : DEFAULT_VIDEO_QUALITY_PRESET;
}

/** Soglie mobile: il preset (anche HIGH = channelLastN -1, 720p) è identico su
 *  desktop e mobile, ma un telefono che decodifica molti stream remoti fino a
 *  720p su rete cellulare scalda, scarica e fa crashare l'iframe (utenti
 *  mobile persi). Su mobile capiamo gli stream ricevuti e la risoluzione. */
const MOBILE_MAX_HEIGHT = 360;
const MOBILE_CHANNEL_LAST_N = 4;

/** Jitsi `configOverwrite` keys for a quality preset. Spread into the iframe
 *  config so they override the static defaults. Unknown-to-this-build keys are
 *  harmlessly ignored by Jitsi. On mobile, received-stream count + resolution
 *  are capped (decode/radio/battery). */
export function resolveVideoQualityConfig(
  preset?: string | null,
  opts?: { isMobile?: boolean },
): Record<string, unknown> {
  const base = { ...QUALITY_DEFINITIONS[normalizeQualityPreset(preset)].configOverwrite };
  if (!opts?.isMobile) return base;
  const lastN =
    base.channelLastN === -1
      ? MOBILE_CHANNEL_LAST_N
      : Math.min(base.channelLastN, MOBILE_CHANNEL_LAST_N);
  return {
    ...base,
    channelLastN: lastN,
    resolution: Math.min(base.resolution, MOBILE_MAX_HEIGHT),
    constraints: { video: { height: { ideal: MOBILE_MAX_HEIGHT, max: MOBILE_MAX_HEIGHT, min: 180 } } },
    // Niente "full-res" su mobile: tutti i remoti restano al layer basso.
    maxFullResolutionParticipants: 0,
  };
}

/** Max video height (px) for the preset — pass to
 *  `executeCommand('setVideoQuality', …)` to enforce at runtime. Capped on mobile. */
export function videoQualityMaxHeight(preset?: string | null, opts?: { isMobile?: boolean }): number {
  const h = QUALITY_DEFINITIONS[normalizeQualityPreset(preset)].maxHeight;
  return opts?.isMobile ? Math.min(h, MOBILE_MAX_HEIGHT) : h;
}
