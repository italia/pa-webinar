/**
 * Jitsi IFrame API configuration.
 *
 * We hide most of Jitsi's native UI and replace it with our own
 * controls built with design-react-kit. Communication happens via
 * JitsiMeetExternalAPI commands and event listeners.
 */

/**
 * Config overrides — hides Jitsi native UI elements.
 * Passed as `configOverwrite` to JitsiMeetExternalAPI.
 */
export const jitsiConfigOverwrite = {
  // Audio/video defaults
  startWithAudioMuted: true,
  startWithVideoMuted: true,

  // Disable Jitsi's own prejoin — we handle it in the portal
  prejoinConfig: { enabled: false },

  // Disable deep linking to mobile app
  disableDeepLinking: true,

  // Hide conference subject and timer from Jitsi's UI
  hideConferenceSubject: true,
  hideConferenceTimer: false,

  // Disable user profile editing in Jitsi
  disableProfile: true,

  // Chat is managed by our Q&A system
  disableChat: true,

  // No Jitsi welcome or close pages
  enableWelcomePage: false,
  enableClosePage: false,

  // Disable invite — registration is handled by our portal
  disableInviteFunctions: true,

  // Hide ALL toolbar buttons — we provide our own controls
  toolbarButtons: [] as string[],

  // Disable notifications — we handle our own
  notifications: [] as string[],

  // Disable reactions (emoji)
  disableReactions: true,

  // Breakout rooms disabled for now
  breakoutRooms: {
    hideAddRoomButton: true,
    hideAutoAssignButton: true,
    hideJoinRoomButton: true,
  },

  // Disable P2P to force server-side routing (important for recording)
  p2p: { enabled: false },

  // Disable file sharing
  enableFileSharing: false,

  // Disable lobby (we handle access via JWT)
  enableLobbyChat: false,
} as const;

/**
 * Interface config overrides — hides Jitsi branding and chrome.
 * Passed as `interfaceConfigOverwrite` to JitsiMeetExternalAPI.
 */
export const jitsiInterfaceConfigOverwrite = {
  SHOW_JITSI_WATERMARK: false,
  SHOW_WATERMARK_FOR_GUESTS: false,
  SHOW_BRAND_WATERMARK: false,

  // Empty toolbar (we provide our own)
  TOOLBAR_BUTTONS: [] as string[],

  // Hide invite header
  HIDE_INVITE_MORE_HEADER: true,

  // Disable join/leave notifications (noisy with many participants)
  DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,

  // No mobile app promo
  MOBILE_APP_PROMO: false,

  // No Chrome extension banner
  SHOW_CHROME_EXTENSION_BANNER: false,

  // Disable dominant speaker indicator (clutters UI)
  DISABLE_DOMINANT_SPEAKER_INDICATOR: false,

  // Video quality label
  DISABLE_VIDEO_BACKGROUND: false,

  // Film strip (thumbnails) — we keep this as Jitsi manages it well
  FILM_STRIP_MAX_HEIGHT: 120,
  VERTICAL_FILMSTRIP: true,
} as const;

/**
 * Moderator-specific config additions.
 * Merged with base config when the user is a moderator.
 */
export const jitsiModeratorConfigOverwrite = {
  // Moderators can use these toolbar buttons
  // (still empty — we use executeCommand from our own buttons)
  toolbarButtons: [] as string[],
} as const;

/**
 * Participant feature flags set via JWT context.
 * Controls what Jitsi allows per-user.
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
  'screen-sharing': false,
  'outbound-call': false,
};

export const moderatorFeatures: JitsiJwtFeatures = {
  recording: true,
  livestreaming: false,
  'screen-sharing': true,
  'outbound-call': false,
};
