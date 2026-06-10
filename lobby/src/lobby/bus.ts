import mitt from 'mitt';
import type { Emitter } from 'mitt';

import type {
  DeviceSelection,
  EmoteType,
  EventStatus,
  PlayerProfile,
} from './ports/types';

/**
 * Internal event bus connecting the Phaser scene and the DOM UI overlays.
 *
 * Direction is by convention:
 *  - UI → scene/game:  profileChange, emote, joinRequest, openOnboarding
 *  - scene/game → UI:  gateZone, statusChange, countdown, peerCount, canEnter,
 *                      joined
 *
 * Keeping this in one typed emitter means the UI never reaches into Phaser and
 * the scene never touches the DOM controls directly.
 */
export type LobbyEvents = {
  /** Local user edited identity/appearance in the personalization bar. */
  profileChange: Partial<PlayerProfile>;
  /** Local user triggered an emote from the UI (keyboard is handled in-scene). */
  emote: EmoteType;
  /** Info button pressed → (re)open the onboarding overlay. */
  openOnboarding: void;
  /** Player entered (true) / left (false) the gate trigger zone. */
  gateZone: boolean;
  /** ConfigPanel "Entra" pressed with the chosen devices. */
  joinRequest: DeviceSelection;
  /** Join completed; the local avatar is now in the amphitheatre. */
  joined: void;
  /** Event status changed (mirrored from EventSchedule for the UI). */
  statusChange: EventStatus;
  /** Whether entering is currently allowed (live, or host during scheduled). */
  canEnter: boolean;
  /** Milliseconds until the event starts; <= 0 once live. */
  countdown: number;
  /** Number of people currently in the garden + amphitheatre (incl. self). */
  peerCount: number;
  /** Touch joystick axis in [-1,1] (UI → scene → Movement). */
  joyAxis: { x: number; y: number };
  /** Legacy users: "Versione classica" pressed → host switches engine. */
  requestClassic: void;
  /** Legacy users: top "Entra" pressed → open the config panel from anywhere. */
  requestEnter: void;
  /** Audio mute/unmute toggle pressed. */
  audioToggle: void;
  /** Current audio on/off state (AudioSystem → UI to sync the icon). */
  audioState: boolean;
};

export type LobbyBus = Emitter<LobbyEvents>;

export function createBus(): LobbyBus {
  return mitt<LobbyEvents>();
}

/** Subscribe and get an unsub back (mitt's `on` returns void). */
export function busOn<K extends keyof LobbyEvents>(
  bus: LobbyBus,
  ev: K,
  cb: (p: LobbyEvents[K]) => void,
): () => void {
  bus.on(ev, cb);
  return () => bus.off(ev, cb);
}
