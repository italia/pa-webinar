import type * as Phaser from 'phaser';

import type { LobbyBus } from './bus';
import type { ConferenceState } from './ports/ConferenceState';
import type { EventSchedule } from './ports/EventSchedule';
import type { MediaDevices } from './ports/MediaDevices';
import type { PresenceClient } from './ports/PresenceClient';
import type { PlayerProfile } from './ports/types';
import type { AssetConfig } from './public-types';
import type { AudioSystem } from './systems/AudioSystem';

export interface ResolvedConfig {
  worldSize: { w: number; h: number };
  capacityHint: number;
  map: 'piazza' | 'classic';
  assets: AssetConfig | undefined;
  /** Whether the host wired an onExitToClassic handler (shows the button). */
  canExitClassic: boolean;
}

/**
 * Everything the scenes need from the outside world, handed in by LobbyGame
 * via the Phaser registry. The scene never imports the deps directly — it
 * reads them from here, which keeps the game decoupled from the mocks/reals.
 */
export interface LobbyContext {
  presence: PresenceClient;
  conference: ConferenceState;
  schedule: EventSchedule;
  media: MediaDevices;
  bus: LobbyBus;
  audio: AudioSystem;
  config: ResolvedConfig;
  /** Current local profile snapshot. */
  getProfile(): PlayerProfile;
  /** Single funnel for profile mutation — UI bar and public API both call it. */
  setProfile(p: Partial<PlayerProfile>): void;
}

export const CONTEXT_KEY = 'lobbyContext';

export function getContext(scene: Phaser.Scene): LobbyContext {
  return scene.registry.get(CONTEXT_KEY) as LobbyContext;
}
