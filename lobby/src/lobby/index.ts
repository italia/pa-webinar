/**
 * PUBLIC API — the only module the host webapp imports.
 *
 * The host calls `mountLobby(container, config, deps)` and gets a
 * {@link LobbyHandle}. Everything the lobby touches in the outside world
 * (presence, conference, schedule, devices) is injected via `deps`, so
 * swapping a Mock* for a real adapter is a one-line change at the call site —
 * the game never imports Jitsi, websockets, or fetches the backend itself.
 */
import { LobbyGame } from './LobbyGame';
import type { LobbyConfig, LobbyDeps, LobbyHandle } from './public-types';
import type { PlayerProfile } from './ports/types';

// Re-export the full contract surface so the host imports everything from here.
export type {
  AssetConfig,
  LobbyConfig,
  LobbyDeps,
  LobbyHandle,
} from './public-types';
export type { PresenceClient } from './ports/PresenceClient';
export type { ConferenceState } from './ports/ConferenceState';
export type { EventSchedule, EventStatus } from './ports/EventSchedule';
export type { MediaDevices, MediaDeviceLists } from './ports/MediaDevices';
export type {
  PlayerProfile,
  PeerState,
  DeviceSelection,
  Facing,
  EmoteType,
  Unsub,
} from './ports/types';

export function mountLobby(
  container: HTMLElement,
  config: LobbyConfig,
  deps: LobbyDeps,
): LobbyHandle {
  const game = new LobbyGame(container, config, deps);
  return {
    setProfile: (p: Partial<PlayerProfile>) => game.setProfile(p),
    destroy: () => game.destroy(),
  };
}
