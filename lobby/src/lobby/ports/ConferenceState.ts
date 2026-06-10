import type { DeviceSelection, Unsub } from './types';

/**
 * The set of people actually inside the Jitsi videocall, plus the join/leave
 * controls. The future real implementation wraps lib-jitsi-meet (or the IFrame
 * API events from jitsi-room.tsx); the dev harness uses MockConferenceState.
 *
 * Architectural note (two sources of truth that converge): identity + position
 * of an avatar come from {@link PresenceClient}; whether that avatar is
 * `inCall` is owned here. The PeerStore reconciles both into one merged state.
 */
export interface ConferenceState {
  /** Ids currently present in the conference. */
  getParticipants(): { id: string }[];
  /** Enter the call with the chosen devices. Resolves once joined. */
  join(devices: DeviceSelection): Promise<void>;
  leave(): Promise<void>;
  on(ev: 'participantJoin' | 'participantLeave', cb: (id: string) => void): Unsub;
}
