import type { ConferenceState } from './ports/ConferenceState';
import type { EventSchedule } from './ports/EventSchedule';
import type { MediaDevices } from './ports/MediaDevices';
import type { PresenceClient } from './ports/PresenceClient';
import type { EmoteType, PlayerProfile } from './ports/types';

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
  /**
   * Testi del cancello, gia' tradotti dalla pagina che ospita la piazza.
   * Mancanti, restano quelli italiani: la piazza si usa anche da sola, nel
   * banco di prova. `{time}` in `startsIn` e' il conto alla rovescia.
   */
  labels?: Partial<GateLabels>;
}

export interface GateLabels {
  /** Il cartello sopra il cancello e i nomi dei quattro spazi della piazza. */
  gateSign: string;
  zoneCafe: string;
  zoneBoard: string;
  zoneGallery: string;
  zoneLab: string;
  gateOpen: string;
  stageLive: string;
  gatePreparing: string;
  stagePreparing: string;
  ended: string;
  startsIn: string;
  hostEarly: string;
}

export const DEFAULT_GATE_LABELS: GateLabels = {
  gateSign: 'Ingresso videochiamata',
  zoneCafe: 'Caffè',
  zoneBoard: 'Bacheca',
  zoneGallery: 'Galleria',
  zoneLab: 'Laboratorio',
  gateOpen: 'Ingresso aperto',
  stageLive: '● IN DIRETTA',
  gatePreparing: 'La sala si sta preparando…',
  stagePreparing: 'Fra poco',
  ended: 'Evento terminato',
  startsIn: 'Inizia tra {time}',
  hostEarly: 'Ingresso anticipato (host)',
};

export interface LobbyDeps {
  presence: PresenceClient;
  conference: ConferenceState;
  schedule: EventSchedule;
  media: MediaDevices;
}

export interface LobbyHandle {
  /** Si risolve quando la scena è partita: prima, i messaggi della chat
   *  (showChatMessage, setTyping…) andrebbero persi. */
  readonly ready: Promise<void>;
  /** Live update of the local player's name / colour / accessories. */
  setProfile(p: Partial<PlayerProfile>): void;
  /** Un messaggio della chat dell'evento: il fumetto sopra chi l'ha scritto
   *  (riconosciuto dal nome mostrato). `ageMs`: quanto è vecchio il messaggio,
   *  perché resti solo per il tempo che gli rimane. */
  showChatMessage(name: string, text: string, ageMs?: number, id?: string, self?: boolean): void;
  /** Un messaggio nascosto o cancellato in chat: il suo fumetto sparisce. */
  clearChatMessage(id: string): void;
  /** Un messaggio corretto in chat: il fumetto mostra il testo nuovo. */
  editChatMessage(id: string, text: string): void;
  /** Chi sta scrivendo in chat adesso: i puntini sopra la testa. */
  setTyping(names: string[]): void;
  /** Un gesto dell'avatar locale (dai pulsanti della pagina). */
  emote(type: EmoteType): void;
  /** Suoni accesi o spenti; restituisce lo stato. */
  setAudio(on: boolean): boolean;
  /** Full teardown: sprites, listeners, RAF, Phaser game, media streams. */
  destroy(): void;
}
