/**
 * Jitsi IFrame API configuration.
 *
 * We show Jitsi's native toolbar for essential controls (mic, camera,
 * screen share, etc.) while keeping our custom wrapper for moderator
 * features (recording, end event) and the Q&A panel.
 *
 * Chat and reactions are handled by custom components in the app sidebar
 * and as a floating overlay, so they are excluded from the Jitsi toolbar.
 */

/**
 * DTD / Bootstrap Italia aligned palette for Jitsi's customTheme.
 * Token reference: https://github.com/jitsi/jitsi-meet/blob/master/resources/custom-theme/custom-theme.json
 */
export const dtdJitsiTheme = {
  palette: {
    uiBackground: '#0F1B2D',
    ui01: '#17324D',
    ui02: '#17324D',
    ui03: '#2E4A62',
    ui04: '#3D5A80',
    ui05: '#5A768A',
    action01: '#0066CC',
    action01Hover: '#004D99',
    action01Active: '#003D7A',
    action02: '#17324D',
    action02Hover: '#2E4A62',
    action02Active: '#0F1B2D',
    action03: 'transparent',
    action03Hover: '#2E4A62',
    action03Active: '#17324D',
    actionDanger: '#D9364F',
    actionDangerHover: '#E04757',
    actionDangerActive: '#A21B29',
    disabled01: '#1A3A5C',
    bottomSheet: '#0F1B2D',
    text01: '#FFFFFF',
    text02: '#C9D4DE',
    text03: '#8899AA',
    text04: '#AAB8C8',
    textError: '#E04757',
    icon01: '#FFFFFF',
    icon02: '#C9D4DE',
    icon03: '#8899AA',
    iconError: '#E04757',
    field01: '#0F1B2D',
    link01: '#4D9AFF',
    link01Hover: '#80B8FF',
    link01Active: '#0066CC',
    success01: '#008758',
    success02: '#008758',
    warning01: '#A66300',
    warning02: '#A66300',
    support01: '#FF9B42',
    support02: '#F96E57',
    support03: '#DF486F',
    support04: '#B23683',
    support05: '#73348C',
    support06: '#6A50D3',
    support07: '#0066CC',
    support08: '#00A8B3',
    support09: '#008758',
  },
};

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

  customTheme: dtdJitsiTheme,

  breakoutRooms: {
    hideAddRoomButton: true,
    hideAutoAssignButton: true,
    hideJoinRoomButton: true,
  },

  p2p: { enabled: false },
  enableFileSharing: false,
  enableLobbyChat: false,
  disableThirdPartyRequests: true,
  brandingRoomAlias: null,

  // Nuclear watermark removal
  'watermark.enabled': false,

  // Dynamic branding — served by /api/jitsi-branding.json (settings-driven).
  // Works cross-origin in production via Ingress; may fail silently in local dev.
  brandingDataUrl: null,
  dynamicBrandingUrl:
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/jitsi-branding.json`
      : '/api/jitsi-branding.json',
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
  PROVIDER_NAME: 'DTD',
  APP_NAME: 'Eventi DTD',
  NATIVE_APP_NAME: 'Eventi DTD',

  TOOLBAR_BUTTONS: baseToolbarButtons as string[],
  TOOLBAR_ALWAYS_VISIBLE: false,
  INITIAL_TOOLBAR_TIMEOUT: 5000,
  TOOLBAR_TIMEOUT: 4000,

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
