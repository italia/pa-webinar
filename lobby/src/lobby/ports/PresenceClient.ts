import type { EmoteType, Facing, PeerState, PlayerProfile, Unsub } from './types';

/**
 * Realtime presence in the garden: where everyone is, who they are, what
 * they're doing. The future real implementation wraps the `/garden/ping`
 * Redis loop (or a Colyseus room); the dev harness uses MockPresenceClient.
 *
 * Contract notes:
 *  - `move()` is called freely by the game (potentially every frame); the
 *    implementation throttles network emission to ~10Hz internally.
 *  - `getPeers()` returns every known peer EXCLUDING self.
 *  - every `on(...)` returns an Unsub for clean teardown.
 */
export interface PresenceClient {
  connect(profile: PlayerProfile): Promise<void>;
  /** Propagate a profile change (name / colour / accessories) for self. */
  setProfile(p: Partial<PlayerProfile>): void;
  /** Report self transform. Implementation throttles to ~10Hz internally. */
  move(x: number, y: number, facing: Facing): void;
  /** Broadcast a self emote. */
  emote(type: EmoteType): void;
  /** All known peers, excluding self. */
  getPeers(): PeerState[];
  on(
    ev: 'peerJoin' | 'peerLeave' | 'peerMove' | 'peerEmote' | 'peerProfile',
    cb: (peer: PeerState) => void,
  ): Unsub;
  disconnect(): void;
}
