import type { ConferenceState } from './ports/ConferenceState';
import type { EventSchedule } from './ports/EventSchedule';
import type { MediaDevices } from './ports/MediaDevices';
import type { PresenceClient } from './ports/PresenceClient';
import type { PlayerProfile } from './ports/types';

/** Optional real assets that replace the programmatic placeholders. */
export interface AssetConfig {
  /** Tiled map (.tmj) URL — replaces buildPlaceholderMap when provided. */
  tilemapUrl?: string;
  /** Tileset image URL paired with the tilemap. */
  tilesetUrl?: string;
  /** Avatar spritesheet URL — replaces the parametric AvatarTextureFactory. */
  avatarSpriteUrl?: string;
}

export interface LobbyConfig {
  /** World dimensions in pixels. Default 1600 × 1024 (larger than viewport). */
  worldSize?: { w: number; h: number };
  /** Expected concurrent people — tunes pooling / spawn density. Default 80. */
  capacityHint?: number;
  /** Seed identity/appearance for the local player. */
  initialProfile?: Partial<PlayerProfile>;
  /**
   * Map theme. 'piazza' (default) = the .italia pastel civic-square map;
   * 'classic' = the legacy garden + theatre map.
   */
  map?: 'piazza' | 'classic';
  /** Override the placeholder art with real tilemap / spritesheet. */
  assets?: AssetConfig;
  /**
   * Host hook for the "Versione classica" button — switch the waiting-room back
   * to the classic/SVG experience. No-op (button hidden) when not provided.
   */
  onExitToClassic?: () => void;
  /**
   * Embed mode: the lobby renders inside a small boxed area of the host page
   * (the waiting-room "Mentre aspetti" card) rather than full-screen. The
   * full-screen chrome (onboarding modal, top bar + enter button, status
   * badge, device panel) is suppressed — the host shell owns the name input
   * and the "Entra" CTA, so the box is an ambient, walkable world preview.
   * Default false (stand-alone full-screen lobby).
   */
  embed?: boolean;
}

export interface LobbyDeps {
  presence: PresenceClient;
  conference: ConferenceState;
  schedule: EventSchedule;
  media: MediaDevices;
}

export interface LobbyHandle {
  /** Live update of the local player's name / colour / accessories. */
  setProfile(p: Partial<PlayerProfile>): void;
  /** Full teardown: sprites, listeners, RAF, Phaser game, media streams. */
  destroy(): void;
}
