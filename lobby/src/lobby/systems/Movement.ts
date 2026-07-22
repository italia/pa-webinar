import { MOVE_SPEED, PLAYER_RADIUS } from '../constants';
import type { EmoteType, Facing } from '../ports/types';
import type { Collider } from './WorldMap';

export interface MovementCallbacks {
  onJump(): void;
  onEmote(type: EmoteType): void;
}

export interface MoveResult {
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
}

/**
 * Local player input + integration + collision.
 *
 * Input comes from our own document listeners (NOT Phaser's global keyboard) so
 * the DOM UI overlays keep working: arrow keys always move (and blur a focused
 * field), WASD only moves when the user isn't typing, Space=jump and E=emote
 * fire only when no form control is focused. A `setExternalAxis` hook lets a
 * touch joystick feed the same pipeline.
 *
 * Movement is authoritative and immediate (no physics engine): we integrate
 * velocity, then push the feet-circle out of every collider, then clamp to the
 * world. Axis-independent push-out gives natural wall sliding.
 */
export class Movement {
  private readonly down = new Set<string>();
  private extX = 0;
  private extY = 0;
  private facing: Facing = 'down';
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(
    private readonly world: { w: number; h: number },
    private readonly cbs: MovementCallbacks,
  ) {
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onKeyUp = (e) => this.handleKeyUp(e);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
  }

  /** Joystick / external axis in [-1,1]. */
  setExternalAxis(x: number, y: number): void {
    this.extX = clamp(x, -1, 1);
    this.extY = clamp(y, -1, 1);
  }

  update(dtMs: number, pos: { x: number; y: number }, colliders: Collider[]): MoveResult {
    const dt = dtMs / 1000;

    let ax = 0;
    let ay = 0;
    if (this.down.has('arrowup') || this.down.has('w')) ay -= 1;
    if (this.down.has('arrowdown') || this.down.has('s')) ay += 1;
    if (this.down.has('arrowleft') || this.down.has('a')) ax -= 1;
    if (this.down.has('arrowright') || this.down.has('d')) ax += 1;
    ax += this.extX;
    ay += this.extY;

    const len = Math.hypot(ax, ay);
    const moving = len > 0.01;
    if (moving) {
      const nx = ax / len;
      const ny = ay / len;
      const speed = MOVE_SPEED * Math.min(1, len); // joystick intensity
      let x = pos.x + nx * speed * dt;
      let y = pos.y + ny * speed * dt;

      // Resolve collisions (two passes for stacked obstacles).
      for (let pass = 0; pass < 2; pass++) {
        for (const c of colliders) {
          if (c.kind === 'rect') {
            ({ x, y } = resolveRect(x, y, c.rect));
          } else {
            ({ x, y } = resolveCircle(x, y, c.x, c.y, c.r));
          }
        }
      }

      // Clamp to world (avatar feet stay inside a margin).
      const m = PLAYER_RADIUS + 4;
      x = clamp(x, m, this.world.w - m);
      y = clamp(y, m, this.world.h - m);

      this.facing =
        Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'right' : 'left') : ny > 0 ? 'down' : 'up';

      return { x, y, facing: this.facing, moving: true };
    }

    return { x: pos.x, y: pos.y, facing: this.facing, moving: false };
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    this.down.clear();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    const isArrow =
      k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright';
    const isWasd = k === 'w' || k === 'a' || k === 's' || k === 'd';
    const target = e.target as HTMLElement | null;
    const typing = isTextEntry(target);

    if (k === ' ' || k === 'spacebar') {
      if (typing || isActivatable(target)) return;
      e.preventDefault();
      this.cbs.onJump();
      return;
    }
    if (k === 'e') {
      if (typing) return;
      this.cbs.onEmote('wave');
      return;
    }
    if (k === 'h') {
      if (typing) return;
      this.cbs.onEmote('heart');
      return;
    }
    if (!isArrow && !isWasd) return;
    // Mentre si scrive, le frecce sono del CURSORE DI TESTO, sempre.
    //
    // Prima le frecce facevano `target.blur()` e prendevano il comando: aveva
    // senso quando l'unico campo era la casella del nome dentro il gioco, un
    // dettaglio da cui uscire. Ora accanto alla piazza c'è il pannello della
    // sala d'attesa — nome, email, chat — e correggere un refuso con la freccia
    // sinistra buttava fuori dal campo e faceva camminare l'avatar.
    if (typing) return;
    e.preventDefault();
    this.down.add(k);
  }

  private handleKeyUp(e: KeyboardEvent): void {
    this.down.delete(e.key.toLowerCase());
  }
}

/**
 * Si sta SCRIVENDO: il tasto appartiene al cursore di testo, non al gioco.
 *
 * I bottoni sono deliberatamente fuori. La piazza porta il fuoco sul pulsante
 * di uscita appena si entra, e trattarlo come «sto scrivendo» lasciava
 * l'avatar immobile: le frecce non facevano nulla finché non si cliccava sul
 * canvas — e chi naviga da tastiera non aveva alcun modo di sbloccarsi.
 */
function isTextEntry(el: HTMLElement | null): boolean {
  if (!el) return false;
  return /^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable;
}

/**
 * Un controllo che la BARRA SPAZIATRICE attiva (bottoni, link).
 *
 * Lo spazio fa saltare l'avatar, ma su un controllo a fuoco significa
 * «premilo»: rubarlo con preventDefault renderebbe l'uscita dalla piazza
 * inutilizzabile da tastiera. Le frecce invece restano al gioco.
 */
function isActivatable(el: HTMLElement | null): boolean {
  if (!el) return false;
  return /^(button|a)$/i.test(el.tagName) || el.getAttribute('role') === 'button';
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function resolveRect(
  x: number,
  y: number,
  rect: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const cx = clamp(x, left, right);
  const cy = clamp(y, top, bottom);
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  const r = PLAYER_RADIUS;
  if (d2 > r * r) return { x, y };
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
  }
  // Centre inside the rect → push out the nearest edge.
  const dl = x - left;
  const dr = right - x;
  const dt = y - top;
  const db = bottom - y;
  const min = Math.min(dl, dr, dt, db);
  if (min === dl) return { x: left - r, y };
  if (min === dr) return { x: right + r, y };
  if (min === dt) return { x, y: top - r };
  return { x, y: bottom + r };
}

function resolveCircle(
  x: number,
  y: number,
  ox: number,
  oy: number,
  or: number,
): { x: number; y: number } {
  const dx = x - ox;
  const dy = y - oy;
  const rr = or + PLAYER_RADIUS;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return { x, y };
  const d = Math.sqrt(d2);
  if (d < 0.0001) return { x: ox + rr, y: oy };
  return { x: ox + (dx / d) * rr, y: oy + (dy / d) * rr };
}
