import * as Phaser from 'phaser';

import { INTERP_RATE } from '../constants';
import type { EmoteType, Facing, PlayerProfile } from '../ports/types';
import {
  AVATAR_H,
  AVATAR_W,
  appearanceKey,
  ensureAvatarTexture,
  type AvatarAppearance,
} from './AvatarTextureFactory';

const EMOTE_GLYPH: Record<EmoteType, string> = { wave: '👋', heart: '❤️' };
const HOP_MS = 460;
const HOP_HEIGHT = 22;
const EMOTE_MS = 1500;
/** Cap remote extrapolation so a stale target never flings the avatar away. */
const DEAD_RECKON_CAP_MS = 160;

export interface AvatarSpriteOptions {
  isSelf?: boolean;
  /** Remote peers lerp toward their target; the local player is authoritative. */
  interpolate?: boolean;
}

/**
 * One avatar = one Phaser Container holding shadow, body, nametag and an emote
 * bubble. The container's position IS the avatar's ground point (feet); its
 * depth tracks y so the world y-sorts. Art comes from the texture factory, so
 * this class never draws a pixel — it only animates and interpolates.
 */
export class AvatarSprite {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly body: Phaser.GameObjects.Image;
  private readonly nametag: Phaser.GameObjects.Text;
  private readonly emote: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Arc | null;

  private readonly isSelf: boolean;
  private readonly interpolate: boolean;

  private appearance: AvatarAppearance;
  private facing: Facing = 'down';
  private moving = false;
  private walkPhase = 0;
  private hopElapsed = -1;
  private emoteUntil = 0;
  private pinnedName = false; // inCall → name always visible
  private nameWanted = true;
  private culled = false;

  // Interpolation state (remote peers). setTarget may be called every frame
  // with the latest *polled* position; it only registers a new "sample" when
  // the coordinates actually change (≈10Hz), and decays to stationary when they
  // stop, so a paused peer never drifts off its spot.
  private targetX: number;
  private targetY: number;
  private velX = 0;
  private velY = 0;
  private lastSampleAt = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    profile: PlayerProfile,
    inCall: boolean,
    opts: AvatarSpriteOptions = {},
  ) {
    this.scene = scene;
    this.isSelf = opts.isSelf ?? false;
    this.interpolate = opts.interpolate ?? false;
    this.appearance = profileAppearance(profile, inCall);
    this.targetX = x;
    this.targetY = y;

    this.shadow = scene.add.ellipse(0, 0, 28, 11, 0x000000, 0.28);

    const texKey = ensureAvatarTexture(scene, this.appearance);
    this.body = scene.add.image(0, 1, texKey).setOrigin(0.5, 1);

    this.ring = this.isSelf
      ? scene.add.circle(0, -1, 17).setStrokeStyle(2.5, 0x36e0ff, 0.9)
      : null;

    this.nametag = scene.add
      .text(0, -AVATAR_H - 4, displayName(profile, this.isSelf), {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#0c1422',
        strokeThickness: 3,
        fontStyle: this.isSelf ? 'bold' : 'normal',
      })
      .setOrigin(0.5, 1);

    this.emote = scene.add
      .text(0, -AVATAR_H - 20, '', { fontSize: '24px' })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const children: Phaser.GameObjects.GameObject[] = [this.shadow];
    if (this.ring) children.push(this.ring);
    children.push(this.body, this.nametag, this.emote);

    this.container = scene.add.container(x, y, children);
    this.container.setDepth(y);
  }

  get x(): number {
    return this.container.x;
  }
  get y(): number {
    return this.container.y;
  }

  /** Update identity/appearance (name + colour + accessories). */
  setProfile(profile: PlayerProfile): void {
    this.nametag.setText(displayName(profile, this.isSelf));
    this.applyAppearance(profileAppearance(profile, this.appearance.inCall));
  }

  setInCall(inCall: boolean): void {
    if (inCall === this.appearance.inCall) return;
    this.pinnedName = inCall;
    this.applyAppearance({ ...this.appearance, inCall });
  }

  private applyAppearance(next: AvatarAppearance): void {
    if (appearanceKey(next) === appearanceKey(this.appearance)) {
      this.appearance = next;
      return;
    }
    this.appearance = next;
    const texKey = ensureAvatarTexture(this.scene, next);
    this.body.setTexture(texKey);
  }

  /** Local authoritative position — applied immediately, no smoothing. */
  setLocal(x: number, y: number, facing: Facing, moving: boolean): void {
    this.container.setPosition(x, y);
    this.facing = facing;
    this.moving = moving;
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Latest polled remote position. Safe to call every frame: a real new sample
   * (changed coords) updates the velocity estimate; an unchanged position that
   * persists decays the avatar to stationary so dead-reckoning never drifts it.
   */
  setTarget(x: number, y: number, facing: Facing, now: number): void {
    const moved = Math.abs(x - this.targetX) > 0.3 || Math.abs(y - this.targetY) > 0.3;
    if (moved) {
      const dt = now - this.lastSampleAt;
      if (this.lastSampleAt > 0 && dt > 0 && dt < 500) {
        this.velX = clamp((x - this.targetX) / dt, -2, 2);
        this.velY = clamp((y - this.targetY) / dt, -2, 2);
      }
      this.targetX = x;
      this.targetY = y;
      this.lastSampleAt = now;
      this.moving = true;
    } else if (now - this.lastSampleAt > 140) {
      this.velX = 0;
      this.velY = 0;
      this.moving = false;
    }
    this.facing = facing;
  }

  jump(): void {
    if (this.hopElapsed < 0) this.hopElapsed = 0;
  }

  showEmote(type: EmoteType, now: number): void {
    this.emote.setText(EMOTE_GLYPH[type]);
    this.emote.setVisible(true).setAlpha(1).setY(-AVATAR_H - 20);
    this.emoteUntil = now + EMOTE_MS;
  }

  /** Requested by culling; reconciled with the inCall pin in update. */
  setNameVisible(v: boolean): void {
    this.nameWanted = v;
  }

  get isCulled(): boolean {
    return this.culled;
  }

  /**
   * Interest management: hide off-screen avatars and skip their per-frame work.
   * Coming back into view snaps to the latest target so a frozen interpolation
   * never visibly "catches up".
   */
  setCulled(c: boolean): void {
    if (c === this.culled) return;
    this.culled = c;
    this.container.setVisible(!c);
    if (!c) {
      this.container.setPosition(this.targetX, this.targetY);
    }
  }

  /** Park into the reuse pool (kept allocated, hidden). */
  park(): void {
    this.container.setVisible(false);
    this.emote.setVisible(false);
    this.culled = true;
  }

  /** Revive from the pool with a fresh identity/position. */
  reset(profile: PlayerProfile, x: number, y: number, inCall: boolean): void {
    this.appearance = profileAppearance(profile, inCall);
    this.pinnedName = inCall;
    this.nameWanted = true;
    this.facing = 'down';
    this.moving = false;
    this.walkPhase = 0;
    this.hopElapsed = -1;
    this.emoteUntil = 0;
    this.velX = 0;
    this.velY = 0;
    this.lastSampleAt = 0;
    this.targetX = x;
    this.targetY = y;
    this.body.setTexture(ensureAvatarTexture(this.scene, this.appearance));
    this.nametag.setText(displayName(profile, this.isSelf));
    this.emote.setVisible(false);
    this.culled = false;
    this.container.setVisible(true).setPosition(x, y).setDepth(y);
  }

  update(dtMs: number, now: number): void {
    const dt = dtMs / 1000;

    // Interpolate remote peers toward a lightly extrapolated target.
    if (this.interpolate) {
      const elapsed = Math.min(now - this.lastSampleAt, DEAD_RECKON_CAP_MS);
      const ex = this.targetX + this.velX * elapsed;
      const ey = this.targetY + this.velY * elapsed;
      const k = 1 - Math.exp(-INTERP_RATE * dt);
      this.container.x += (ex - this.container.x) * k;
      this.container.y += (ey - this.container.y) * k;
    }

    // Walk bob + facing flip.
    if (this.moving) this.walkPhase += dt * 9;
    const bob = this.moving ? -Math.abs(Math.sin(this.walkPhase)) * 2.2 : 0;
    this.body.setFlipX(this.facing === 'left');

    // Hop.
    let hop = 0;
    let shadowScale = 1;
    if (this.hopElapsed >= 0) {
      this.hopElapsed += dtMs;
      const p = this.hopElapsed / HOP_MS;
      if (p >= 1) {
        this.hopElapsed = -1;
      } else {
        hop = -Math.sin(p * Math.PI) * HOP_HEIGHT;
        shadowScale = 1 - Math.sin(p * Math.PI) * 0.4;
      }
    }
    this.body.setY(1 + bob + hop);
    this.shadow.setScale(shadowScale);

    // Emote float + fade.
    if (this.emote.visible) {
      if (now >= this.emoteUntil) {
        this.emote.setVisible(false);
      } else {
        const remaining = (this.emoteUntil - now) / EMOTE_MS;
        this.emote.setY(-AVATAR_H - 20 - (1 - remaining) * 14);
        this.emote.setAlpha(Math.min(1, remaining * 2));
      }
    }

    // Nametag: pinned for inCall, otherwise driven by culling.
    this.nametag.setVisible(this.pinnedName || this.nameWanted);

    // Depth follows feet y so the world y-sorts.
    this.container.setDepth(this.container.y);
  }

  destroy(): void {
    this.container.destroy(true); // destroys all children
  }
}

function displayName(p: PlayerProfile, isSelf: boolean): string {
  return p.name.trim() || (isSelf ? 'Tu' : 'Ospite');
}

function profileAppearance(p: PlayerProfile, inCall: boolean): AvatarAppearance {
  return {
    color: p.color,
    helmet: p.accessories.helmet ?? false,
    glasses: p.accessories.glasses ?? false,
    inCall,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Re-export so other systems can size things to the avatar without reaching
// into the factory.
export { AVATAR_W, AVATAR_H };
