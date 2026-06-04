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
 * Participant toolbar — NO 'hangup' to avoid "end meeting for all".
 * We provide our own "Esci dalla sala" / "Leave room" button that
 * calls api.executeCommand('hangup') without exposing the
 * "Termina la riunione per tutti" option.
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
  'hangup',
  'mute-everyone',
  'security',
  'participants-pane',
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
 * Moderator mobile toolbar: same trim as participants plus hangup and
 * the participants-pane button (needed to manage the room on small screens).
 */
export const mobileModeratorToolbarButtons = [
  ...mobileBaseToolbarButtons,
  'hangup',
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
  'hangup',
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
