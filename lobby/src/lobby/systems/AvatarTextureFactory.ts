import * as Phaser from 'phaser';

/**
 * AvatarTextureFactory — the ONLY place avatar art lives.
 *
 * Avatars are drawn parametrically from a {@link AvatarAppearance} into a
 * cached Phaser texture (keyed by appearance, so 80 peers sharing 8 shirt
 * colours allocate a handful of textures, not 80). Swapping to a real
 * spritesheet (LPC / Kenney) means replacing `drawAvatar` + `ensureAvatarTexture`
 * and nothing else — AvatarSprite consumes a texture key and is art-agnostic.
 *
 * The figure is a friendly top-down 3/4 character, feet at the bottom-centre of
 * the texture; AvatarSprite anchors it with origin (0.5, 1) so the feet sit on
 * the ground point. Left/right facing is a horizontal flip (per spec, that's
 * enough); `inCall` swaps the eyes for a VR visor.
 */

export const AVATAR_W = 48;
export const AVATAR_H = 64;

/** Curated "geek but tidy" shirt palette (PA-ish, high-contrast). */
export const AVATAR_COLORS = [
  // .italia design-system palette (see avatar.tsx AVATAR_PRESETS).
  '#0066CC',
  '#D9364F',
  '#008758',
  '#7B5AAE',
  '#F7A11A',
  '#17324D',
  '#5A768A',
  '#3A5472',
] as const;

export interface AvatarAppearance {
  /** Shirt colour, hex. */
  color: string;
  helmet: boolean;
  glasses: boolean;
  /** Draw the VR visor (worn when in the videocall). */
  inCall: boolean;
}

// Flatter, .italia-keyed palette: softer navy outline (reads as ink, not
// cartoon black), cooler trousers/shoes that sit in-key against the pastel
// piazza instead of the old near-black.
const SKIN = 0xf3cdac;
const HAIR = 0x5a4636;
const TROUSERS = 0x3a5472;
const SHOE = 0x2b3a55;
const HELMET = 0xf2b134;
const GLASSES = 0x17324d;
const VISOR_BODY = 0x17324d;
const VISOR_GLOW = 0x0066cc;
const OUTLINE = 0x17324d;

function hexToInt(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  return Number.isNaN(n) ? 0x48566a : n;
}

export function appearanceKey(a: AvatarAppearance): string {
  return `avatar:${a.color}:${a.helmet ? 1 : 0}:${a.glasses ? 1 : 0}:${a.inCall ? 1 : 0}`;
}

function drawAvatar(g: Phaser.GameObjects.Graphics, a: AvatarAppearance): void {
  const shirt = hexToInt(a.color);
  const cx = AVATAR_W / 2;

  // Thin unifying outline behind the body mass for a crisp silhouette —
  // soft navy ink, not cartoon black.
  g.lineStyle(1.5, OUTLINE, 0.4);

  // Legs + shoes
  g.fillStyle(TROUSERS, 1);
  g.fillRoundedRect(cx - 8, 44, 7, 15, 3);
  g.fillRoundedRect(cx + 1, 44, 7, 15, 3);
  g.fillStyle(SHOE, 1);
  g.fillRoundedRect(cx - 8, 56, 7, 5, 2);
  g.fillRoundedRect(cx + 1, 56, 7, 5, 2);

  // Arms (behind torso edges)
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(cx - 13, 30, 6, 16, 3);
  g.fillRoundedRect(cx + 7, 30, 6, 16, 3);

  // Torso
  g.fillStyle(shirt, 1);
  g.fillRoundedRect(cx - 11, 28, 22, 20, 6);
  g.strokeRoundedRect(cx - 11, 28, 22, 20, 6);

  // Neck
  g.fillStyle(SKIN, 1);
  g.fillRoundedRect(cx - 3, 24, 6, 6, 2);

  // Head
  g.fillStyle(SKIN, 1);
  g.fillCircle(cx, 17, 11);
  g.strokeCircle(cx, 17, 11);

  // Hair / helmet
  if (a.helmet) {
    g.fillStyle(HELMET, 1);
    g.fillEllipse(cx, 13, 24, 18); // dome
    g.fillRoundedRect(cx - 14, 12, 28, 4, 2); // brim
    g.strokeRoundedRect(cx - 14, 12, 28, 4, 2);
  } else {
    g.fillStyle(HAIR, 1);
    // upper-head hair cap
    g.fillEllipse(cx, 10, 23, 14);
    g.fillRect(cx - 11, 10, 22, 4);
  }

  // Eyes / glasses / visor
  if (a.inCall) {
    // VR visor band
    g.fillStyle(VISOR_BODY, 1);
    g.fillRoundedRect(cx - 11, 13, 22, 9, 4);
    g.fillStyle(VISOR_GLOW, 0.9);
    g.fillRoundedRect(cx - 9, 16, 18, 3, 2);
    // strap
    g.fillStyle(VISOR_BODY, 1);
    g.fillRect(cx - 12, 16, 2, 3);
    g.fillRect(cx + 10, 16, 2, 3);
  } else {
    g.fillStyle(0x2a2018, 1);
    g.fillCircle(cx - 4, 18, 1.6);
    g.fillCircle(cx + 4, 18, 1.6);
    if (a.glasses) {
      g.lineStyle(1.6, GLASSES, 1);
      g.strokeRoundedRect(cx - 8, 15, 7, 6, 2);
      g.strokeRoundedRect(cx + 1, 15, 7, 6, 2);
      g.lineBetween(cx - 1, 17, cx + 1, 17);
    }
  }
}

/** Ensure the texture for this appearance exists; returns its key. */
export function ensureAvatarTexture(
  scene: Phaser.Scene,
  a: AvatarAppearance,
): string {
  const key = appearanceKey(a);
  if (scene.textures.exists(key)) return key;
  // Drawn then destroyed within the same synchronous frame, so the temporary
  // Graphics is never presented to the screen.
  const g = scene.add.graphics();
  drawAvatar(g, a);
  g.generateTexture(key, AVATAR_W, AVATAR_H);
  g.destroy();
  return key;
}
