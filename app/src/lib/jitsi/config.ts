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
