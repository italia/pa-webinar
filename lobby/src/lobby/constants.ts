/** Cross-cutting tuning constants for the lobby world. */

export const DEFAULT_WORLD = { w: 1600, h: 1024 } as const;
export const DEFAULT_CAPACITY = 80;

export const TILE = 32;

/** Local player walk speed, px/sec. */
export const MOVE_SPEED = 200;
/** Feet-circle radius used for collision resolution. */
export const PLAYER_RADIUS = 14;

/** Network move emit cadence (Hz) and derived interval. */
export const PRESENCE_HZ = 10;
export const PRESENCE_INTERVAL_MS = 1000 / PRESENCE_HZ;

/** Show a peer's nametag when within this many px of the local player. */
export const NAMETAG_RADIUS = 95;
/** Draw a dashed proximity link to peers within this many px (player-centric). */
export const PROXIMITY_RADIUS = 150;

/**
 * Remote-position smoothing. Remote peers arrive at ~10Hz; we lerp toward the
 * latest target each frame. Higher = snappier / less smooth. The value is an
 * exponential catch-up rate (per second).
 */
export const INTERP_RATE = 14;

/** Fixed render depths for non-y-sorted layers. Everything else sorts by y. */
export const DEPTH = {
  GROUND: -1000,
  GROUND_DETAIL: -900,
  LINKS: -500,
} as const;
