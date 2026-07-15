/**
 * Type declarations for Jitsi Meet IFrame API.
 *
 * Based on: https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/
 * These types are NOT exhaustive — they cover the commands and events
 * we actually use in pa-webinar.
 */

export interface JitsiMeetExternalAPIOptions {
  roomName: string;
  width?: string | number;
  height?: string | number;
  parentNode?: HTMLElement;
  configOverwrite?: Record<string, unknown>;
  interfaceConfigOverwrite?: Record<string, unknown>;
  jwt?: string;
  lang?: string;
  userInfo?: {
    displayName?: string;
    email?: string;
  };
  onload?: () => void;
}

export interface JitsiParticipant {
  id: string;
  displayName: string;
  formattedDisplayName: string;
  avatarURL?: string;
  role: 'moderator' | 'participant';
}

export interface JitsiChatMessage {
  from: string;
  nick: string;
  message: string;
  privateMessage: boolean;
  stamp: string;
}

export interface JitsiEventMap {
  readyToClose: [];
  videoConferenceJoined: [{ roomName: string; id: string; displayName: string }];
  videoConferenceLeft: [{ roomName: string }];
  participantJoined: [{ id: string; displayName: string }];
  participantLeft: [{ id: string }];
  participantRoleChanged: [{ id: string; role: string }];
  audioMuteStatusChanged: [{ muted: boolean }];
  videoMuteStatusChanged: [{ muted: boolean }];
  raiseHandUpdated: [{ id: string; handRaised: number }];
  recordingStatusChanged: [{ on: boolean; mode: string }];
  audioModerationChanged: [{ enabled: boolean }];
  videoModerationChanged: [{ enabled: boolean }];
  moderationStatusChanged: [{ enabled: boolean; mediaType: string }];
  displayNameChange: [{ id: string; displayname: string }];
  dominantSpeakerChanged: [{ id: string }];
  tileViewChanged: [{ enabled: boolean }];
  filmstripDisplayChanged: [{ visible: boolean }];
  participantsPaneToggled: [{ open: boolean }];
  screenSharingStatusChanged: [{ id: string; on: boolean }];
  incomingMessage: [JitsiChatMessage];
  outgoingMessage: [JitsiChatMessage];
}

export type JitsiEventName = keyof JitsiEventMap;

export interface JitsiMeetExternalAPI {
  // Commands
  executeCommand(command: 'muteEveryone'): void;
  executeCommand(command: 'toggleAudio'): void;
  executeCommand(command: 'toggleVideo'): void;
  executeCommand(command: 'toggleTileView'): void;
  executeCommand(command: 'toggleRaiseHand'): void;
  executeCommand(command: 'toggleFilmStrip'): void;
  executeCommand(command: 'toggleChat'): void;
  executeCommand(command: 'sendChatMessage', message: string, to?: string, ignorePrivacy?: boolean): void;
  executeCommand(command: 'toggleShareScreen'): void;
  executeCommand(command: 'hangup'): void;
  executeCommand(command: 'startRecording', options: { mode: 'file' | 'stream' }): void;
  executeCommand(command: 'stopRecording', mode: 'file' | 'stream'): void;
  executeCommand(command: 'kickParticipant', participantId: string): void;
  executeCommand(command: 'setTileView', enabled: boolean): void;
  executeCommand(command: 'setVideoQuality', quality: number): void;
  executeCommand(command: 'subject', subject: string): void;
  executeCommand(command: 'enableAudioModeration'): void;
  executeCommand(command: 'disableAudioModeration'): void;
  executeCommand(command: 'enableVideoModeration'): void;
  executeCommand(command: 'disableVideoModeration'): void;
  executeCommand(command: 'approveAudio', participantId: string): void;
  executeCommand(command: 'approveVideo', participantId: string): void;
  executeCommand(command: 'setNoiseSuppressionEnabled', enabled: boolean): void;
  /** F12: set a remote participant's playback volume for the LOCAL user only
   *  (0 = muted … 1 = 100%). Does not affect what other participants hear. */
  executeCommand(command: 'setParticipantVolume', participantId: string, level: number): void;
  executeCommand(command: string, ...args: unknown[]): void;

  // Event listeners
  addListener<E extends JitsiEventName>(
    event: E,
    listener: (...args: JitsiEventMap[E]) => void
  ): void;
  removeListener<E extends JitsiEventName>(
    event: E,
    listener: (...args: JitsiEventMap[E]) => void
  ): void;

  // Queries
  getParticipantsInfo(): JitsiParticipant[];
  getNumberOfParticipants(): number;
  /** displayName del partecipante per endpoint id (ADR-013 Fase 0). */
  getDisplayName(participantId: string): string | undefined;
  isAudioMuted(): Promise<boolean>;
  isVideoMuted(): Promise<boolean>;

  // Statistics
  getConnectionQuality(): Promise<JitsiConnectionStats>;

  // Lifecycle
  dispose(): void;
}

export interface JitsiConnectionStats {
  bandwidth?: {
    download?: number;
    upload?: number;
  };
  bitrate?: {
    download?: number;
    upload?: number;
    audio?: { download?: number; upload?: number };
    video?: { download?: number; upload?: number };
  };
  packetLoss?: {
    download?: number;
    upload?: number;
    total?: number;
  };
  resolution?: Record<string, { height?: number; width?: number }>;
  framerate?: Record<string, number>;
  codec?: Record<string, { audio?: string; video?: string }>;
  connectionQuality?: number;
  jvbRTT?: number;
  serverRegion?: string;
  bridgeCount?: number;
  e2eRTT?: number;
  transport?: Array<{ type?: string; localCandidateType?: string; remoteCandidateType?: string; p2p?: boolean }>;
}

/**
 * Global type declaration for the JitsiMeetExternalAPI constructor.
 * It's loaded via <script> from the Jitsi server.
 */
declare global {
  interface Window {
    JitsiMeetExternalAPI: new (
      domain: string,
      options: JitsiMeetExternalAPIOptions
    ) => JitsiMeetExternalAPI;
  }
}
