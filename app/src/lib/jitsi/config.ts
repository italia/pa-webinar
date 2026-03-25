/**
 * Jitsi IFrame API configuration.
 *
 * We show Jitsi's native toolbar for essential controls (mic, camera,
 * screen share, etc.) while keeping our custom wrapper for moderator
 * features (recording, end event) and the Q&A panel.
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
  'chat',
  'hangup',
];

export const moderatorToolbarButtons = [
  ...baseToolbarButtons,
  'mute-everyone',
  'security',
  'participants-pane',
];

/**
 * Config overrides passed as `configOverwrite`.
 * Toolbar buttons are merged at instantiation time based on role.
 */
export const jitsiConfigOverwrite = {
  startWithAudioMuted: true,
  startWithVideoMuted: true,

  prejoinConfig: { enabled: false },
  disableDeepLinking: true,
  hideConferenceSubject: true,
  hideConferenceTimer: false,
  disableProfile: true,

  // Chat is now enabled (native Jitsi chat alongside our Q&A)
  disableChat: false,

  enableWelcomePage: false,
  enableClosePage: false,
  disableInviteFunctions: true,

  // Placeholder — overridden per role at instantiation
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
  disableThirdPartyRequests: true,
  brandingRoomAlias: null,

  // Nuclear watermark removal (newer Jitsi versions)
  defaultLogoUrl: '',
  'watermark.enabled': false,
} as const;

/**
 * Interface config overrides passed as `interfaceConfigOverwrite`.
 */
export const jitsiInterfaceConfigOverwrite = {
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,
  BRAND_WATERMARK_LINK: '',
  JITSI_WATERMARK_LINK: '',
  DEFAULT_LOGO_URL: '',
  DEFAULT_WELCOME_PAGE_LOGO_URL: '',
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
