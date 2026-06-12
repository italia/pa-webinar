import * as Phaser from 'phaser';

import type { LobbyBus } from '../bus';
import type { EventSchedule } from '../ports/EventSchedule';
import type { EventStatus, Unsub } from '../ports/types';
import { formatClock } from '../util';
import type { WorldLayout } from './WorldMap';

/**
 * Event-state gate. Translates {@link EventSchedule} into the world:
 *
 *  - `scheduled` → doors shut, padlock on, dimmed; a countdown ("Inizia tra
 *    mm:ss") is shown over the gate AND on the stage screen.
 *  - `live`      → doors swing open with a glow, the stage reads "● IN DIRETTA".
 *  - `ended`     → doors shut, "Evento terminato".
 *
 * Hosts get the open gate during `scheduled` (early entry). The only mutation
 * is visual + the `canEnter` / `countdown` / `statusChange` signals on the bus;
 * walking through is always blocked (entry is the Entra flow), so this never
 * touches collision.
 *
 * The countdown is recomputed from getStartsAt() every frame and re-broadcast
 * on each whole-second change; status is re-evaluated on `statusChange` with no
 * refresh.
 */
export class CountdownGate {
  private readonly doors: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly gateLabel: Phaser.GameObjects.Text;
  private readonly stageLabel: Phaser.GameObjects.Text;
  private readonly unsub: Unsub;

  private status: EventStatus;
  private openAmount: number;
  private lastSecond = Number.NaN;

  constructor(
    scene: Phaser.Scene,
    private readonly layout: WorldLayout,
    private readonly schedule: EventSchedule,
    private readonly bus: LobbyBus,
  ) {
    this.status = schedule.getStatus();
    this.openAmount = this.targetOpen();

    const dividerY = layout.amphitheatre.bottom;
    this.glow = scene.add.graphics().setDepth(dividerY - 1);
    this.doors = scene.add.graphics().setDepth(dividerY + 2);

    this.gateLabel = scene.add
      .text(layout.gate.centerX, dividerY - 44, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#0c1422',
        strokeThickness: 4,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(4000);

    this.stageLabel = scene.add
      .text(layout.screen.centerX, layout.screen.centerY, '', {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#0066CC',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(4000);

    this.unsub = schedule.on('statusChange', (s) => this.onStatus(s));

    // Prime the UI with the initial state.
    this.bus.emit('statusChange', this.status);
    this.bus.emit('canEnter', this.canEnter());
    this.redraw();
  }

  private onStatus(s: EventStatus): void {
    this.status = s;
    this.bus.emit('statusChange', s);
    this.bus.emit('canEnter', this.canEnter());
  }

  canEnter(): boolean {
    return this.status === 'live' || this.schedule.isHost();
  }

  private targetOpen(): number {
    return this.status === 'live' || this.schedule.isHost() ? 1 : 0;
  }

  update(nowMs: number, dtMs: number): void {
    const remaining = Math.max(0, this.schedule.getStartsAt() - nowMs);
    const sec = Math.floor(remaining / 1000);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.bus.emit('countdown', remaining);
      this.refreshLabels(remaining);
    }

    const target = this.targetOpen();
    const k = Math.min(1, dtMs / 220);
    this.openAmount += (target - this.openAmount) * k;
    this.redraw();
  }

  private refreshLabels(remainingMs: number): void {
    if (this.status === 'live') {
      this.gateLabel.setText('Ingresso aperto').setColor('#008758');
      this.stageLabel.setText('● IN DIRETTA').setColor('#D9364F');
      return;
    }
    if (this.status === 'ended') {
      this.gateLabel.setText('Evento terminato').setColor('#cdd6e0');
      this.stageLabel.setText('Evento terminato').setColor('#cdd6e0');
      return;
    }
    const label = `Inizia tra ${formatClock(remainingMs)}`;
    this.gateLabel
      .setText(this.schedule.isHost() ? 'Ingresso anticipato (host)' : label)
      .setColor('#ffffff');
    this.stageLabel.setText(formatClock(remainingMs)).setColor('#0066CC');
  }

  private redraw(): void {
    const { gate } = this.layout;
    const dividerY = this.layout.amphitheatre.bottom;
    const halfGap = gate.width / 2;
    const leafW = halfGap;
    const slide = this.openAmount * (leafW - 6);
    const open = this.openAmount;

    // Glow behind the gate when (nearly) open — soft cyan, .italia palette.
    this.glow.clear();
    if (open > 0.05) {
      this.glow.fillStyle(0x3da5dc, 0.16 * open);
      this.glow.fillEllipse(gate.centerX, dividerY, gate.width + 80, 90);
    }

    // Door leaves — white panels with an azzurro top inset (.italia portal).
    this.doors.clear();
    const leafFill = this.status === 'ended' ? 0xdfe6ef : 0xffffff;
    const leafTop = this.status === 'ended' ? 0xc3d4e6 : 0xd6e8f7;
    const leftX = gate.centerX - leafW - slide;
    const rightX = gate.centerX + slide;
    for (const x of [leftX, rightX]) {
      this.doors.fillStyle(leafFill, 1);
      this.doors.fillRoundedRect(x, dividerY - 26, leafW, 52, 5);
      this.doors.fillStyle(leafTop, 1);
      this.doors.fillRoundedRect(x + 2, dividerY - 24, leafW - 4, 22, 3);
      this.doors.lineStyle(2, 0xc3d4e6, 1);
      this.doors.strokeRoundedRect(x, dividerY - 26, leafW, 52, 5);
    }

    // Padlock while shut — institutional blue.
    if (open < 0.5) {
      const a = 1 - open * 2;
      const cx = gate.centerX;
      const cy = dividerY - 2;
      this.doors.lineStyle(3, 0x0066cc, a);
      this.doors.strokeCircle(cx, cy - 6, 5); // shackle
      this.doors.fillStyle(0x0066cc, a);
      this.doors.fillRoundedRect(cx - 7, cy - 4, 14, 12, 2); // body
    }
  }

  destroy(): void {
    this.unsub();
    this.doors.destroy();
    this.glow.destroy();
    this.gateLabel.destroy();
    this.stageLabel.destroy();
  }
}
