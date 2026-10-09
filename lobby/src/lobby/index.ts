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
import type { EmoteType, PlayerProfile } from './ports/types';

// Re-export the full contract surface so the host imports everything from here.
export type {
  AssetConfig,
  GateLabels,
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
export { EMOTE_TYPES } from './ports/types';
export { EMOTE_BARRA, EMOTE_GLYPH, EMOTE_KEY } from './emotes';
export { UMORE_GLIFO, UMORI, type Umore } from './umori';
export { CODICI_SEGRETI } from './segreti';

export function mountLobby(
  container: HTMLElement,
  config: LobbyConfig,
  deps: LobbyDeps,
): LobbyHandle {
  const game = new LobbyGame(container, config, deps);
  return {
    setProfile: (p: Partial<PlayerProfile>) => game.setProfile(p),
    showChatMessage: (name: string, text: string, ageMs?: number, id?: string, self?: boolean) =>
      game.showChatMessage(name, text, ageMs, id, self),
    ready: game.ready,
    clearChatMessage: (id: string) => game.clearChatMessage(id),
    editChatMessage: (id: string, text: string) => game.editChatMessage(id, text),
    azione: (id: string) => game.azione(id),
    festa: () => game.festa(),
    presenti: () => game.presenti(),
    umori: () => game.umori(),
    setTyping: (names: string[]) => game.setTyping(names),
    emote: (type: EmoteType) => game.emote(type),
    setAudio: (on: boolean) => game.setAudio(on),
    destroy: () => game.destroy(),
  };
}
