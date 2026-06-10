import type { LobbyBus } from '../bus';
import { el } from './dom';

/**
 * Touch joystick (mobile only, hidden on hover-capable pointers via CSS). Emits
 * a normalised axis on the bus; the scene feeds it into Movement. No movement
 * logic lives here.
 */
export class Joystick {
  private readonly root: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private activeId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly maxRadius = 40;

  private readonly onDown: (e: PointerEvent) => void;
  private readonly onMove: (e: PointerEvent) => void;
  private readonly onEnd: (e: PointerEvent) => void;

  constructor(
    parent: HTMLElement,
    private readonly bus: LobbyBus,
  ) {
    this.thumb = el('div', { class: 'pawl-joy__thumb' });
    this.root = el('div', { class: 'pawl-joy', ariaLabel: 'Controllo movimento' }, [this.thumb]);
    parent.append(this.root);

    this.onDown = (e) => {
      if (this.activeId !== null) return;
      this.activeId = e.pointerId;
      const r = this.root.getBoundingClientRect();
      this.originX = r.left + r.width / 2;
      this.originY = r.top + r.height / 2;
      this.root.setPointerCapture(e.pointerId);
    };
    this.onMove = (e) => {
      if (e.pointerId !== this.activeId) return;
      const dx = e.clientX - this.originX;
      const dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, this.maxRadius);
      const tx = len > 0 ? (dx / len) * clamped : 0;
      const ty = len > 0 ? (dy / len) * clamped : 0;
      this.thumb.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px))`;
      const intensity = clamped / this.maxRadius;
      this.bus.emit('joyAxis', {
        x: len > 0 ? (dx / len) * intensity : 0,
        y: len > 0 ? (dy / len) * intensity : 0,
      });
    };
    this.onEnd = (e) => {
      if (e.pointerId !== this.activeId) return;
      this.activeId = null;
      this.thumb.style.transform = 'translate(-50%, -50%)';
      this.bus.emit('joyAxis', { x: 0, y: 0 });
    };

    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onEnd);
    this.root.addEventListener('pointercancel', this.onEnd);
  }

  destroy(): void {
    this.root.removeEventListener('pointerdown', this.onDown);
    this.root.removeEventListener('pointermove', this.onMove);
    this.root.removeEventListener('pointerup', this.onEnd);
    this.root.removeEventListener('pointercancel', this.onEnd);
    this.root.remove();
  }
}
