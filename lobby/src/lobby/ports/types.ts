/**
 * Shared data types used across the lobby ports and the game.
 *
 * These are the *only* shapes that cross the boundary between the game and
 * the injected dependencies (presence / conference / schedule / media). Keep
 * them framework-agnostic — no Phaser, no DOM-coupling beyond standard lib
 * types (MediaStream / MediaDeviceInfo live in MediaDevices.ts).
 */

/** Unsubscribe handle returned by every `on(...)` subscription. */
export type Unsub = () => void;

export type Facing = 'up' | 'down' | 'left' | 'right';

export type EmoteType = 'wave' | 'heart';

/** The identity + appearance of a participant in the garden. */
export interface PlayerProfile {
  id: string;
  name: string;
  /** Hex shirt colour, e.g. "#185fa5". */
  color: string;
  accessories: { helmet?: boolean; glasses?: boolean };
}

/**
 * A peer as seen over the wire. Extends the profile with transform + liveness.
 * `inCall` is the presence layer's *view* of call membership; the authoritative
 * call membership comes from {@link ConferenceState} and is reconciled in the
 * PeerStore (the two sources of truth converge there).
 */
export interface PeerState extends PlayerProfile {
  x: number;
  y: number;
  facing: Facing;
  inCall: boolean;
  emote?: { type: EmoteType; at: number };
}

/** Device choice produced by the config-at-the-gate panel, consumed by join. */
export interface DeviceSelection {
  cameraId?: string;
  micId?: string;
  outputId?: string;
  videoMuted: boolean;
  audioMuted: boolean;
}

export type EventStatus = 'scheduled' | 'live' | 'ended';
