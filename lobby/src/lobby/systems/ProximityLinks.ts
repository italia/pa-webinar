import * as Phaser from 'phaser';

import { DEPTH, PROXIMITY_RADIUS } from '../constants';
import type { AvatarSprite } from './AvatarSprite';

const R2 = PROXIMITY_RADIUS * PROXIMITY_RADIUS;
const DASH = 7;
const GAP = 6;

/**
 * Player-centric dashed links to nearby peers — a purely visual hint of the
 * "social proximity" idea (no chat/voice logic yet). Drawn from the local
 * player outward only, so it's O(peers) and never an N² mesh.
 */
export class ProximityLinks {
  private readonly g: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.LINKS);
  }

  update(localX: number, localY: number, peers: Iterable<AvatarSprite>): void {
    this.g.clear();
    this.g.lineStyle(2, 0x9fe3ff, 0.5);
    for (const p of peers) {
      if (p.isCulled) continue;
      const dx = p.x - localX;
      const dy = p.y - localY;
      const d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 < 1) continue;
      const d = Math.sqrt(d2);
      const fade = 1 - d / PROXIMITY_RADIUS;
      // Aim at the peer's torso (feet minus ~28) for a tidier look.
      this.drawDashed(localX, localY - 24, p.x, p.y - 28, 0.15 + fade * 0.5);
    }
  }

  private drawDashed(x1: number, y1: number, x2: number, y2: number, alpha: number): void {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 1) return;
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    this.g.lineStyle(2, 0x9fe3ff, alpha);
    let t = 0;
    while (t < len) {
      const segEnd = Math.min(t + DASH, len);
      this.g.lineBetween(x1 + ux * t, y1 + uy * t, x1 + ux * segEnd, y1 + uy * segEnd);
      t = segEnd + GAP;
    }
  }
}
