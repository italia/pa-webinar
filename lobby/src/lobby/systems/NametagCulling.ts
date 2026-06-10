import { NAMETAG_RADIUS } from '../constants';
import type { AvatarSprite } from './AvatarSprite';

export interface CullEntry {
  sprite: AvatarSprite;
  inCall: boolean;
}

const R2 = NAMETAG_RADIUS * NAMETAG_RADIUS;

/**
 * Nametag culling — mandatory for 80 peers. A label is shown only for:
 *   (a) the local player (handled by the scene, pinned),
 *   (b) everyone who is inCall (their sprite pins the name internally),
 *   (c) peers within ~95px of the local player.
 * So we never paint 80 always-on labels. This sets the *proximity* want; the
 * sprite ORs it with its inCall pin.
 */
export function applyNametagCulling(
  localX: number,
  localY: number,
  entries: Iterable<CullEntry>,
): void {
  for (const e of entries) {
    if (e.inCall) {
      e.sprite.setNameVisible(true);
      continue;
    }
    const dx = e.sprite.x - localX;
    const dy = e.sprite.y - localY;
    e.sprite.setNameVisible(dx * dx + dy * dy <= R2);
  }
}
