import * as Phaser from 'phaser';

import type { LobbyBus } from '../bus';
import type { EventSchedule } from '../ports/EventSchedule';
import type { EventStatus, Unsub } from '../ports/types';
import { formatClock } from '../util';
import type { WorldLayout } from './WorldMap';
import { DEFAULT_GATE_LABELS, type GateLabels } from '../public-types';

/**
 * Event-state gate. Translates {@link EventSchedule} into the world:
 *
 *  - `scheduled` → doors shut, padlock on, dimmed; a countdown ("Inizia tra
 *    mm:ss") is shown over the gate AND on the stage screen.
 *  - `preparing` → doors shut with a red rope across them: l'ora e' arrivata
 *    ma la sala non c'e' ancora. Nessun conto alla rovescia — non si sta
 *    aspettando un orario, si sta aspettando una stanza.
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
    private readonly labels: GateLabels = DEFAULT_GATE_LABELS,
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
    // Le scritte si riscrivono anche qui, non solo al cambio di secondo: a
    // evento gia' iniziato il conto alla rovescia e' fermo a zero, quindi
    // quel secondo non cambia piu' e le porte si aprivano sopra un cartello
    // che continuava a dire «si sta preparando».
    this.refreshLabels(Math.max(0, this.schedule.getStartsAt() - Date.now()));
  }

  canEnter(): boolean {
    return this.status === 'live' || this.anticipoHost();
  }

  /** L'ingresso anticipato vale prima dell'ora, non quando la sala non c'e':
   *  a bridge spento anche chi conduce troverebbe una stanza vuota. */
  private anticipoHost(): boolean {
    return this.schedule.isHost() && this.status === 'scheduled';
  }

  private targetOpen(): number {
    return this.status === 'live' || this.anticipoHost() ? 1 : 0;
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
    const l = this.labels;
    if (this.status === 'live') {
      this.gateLabel.setText(l.gateOpen).setColor('#008758');
      this.stageLabel.setText(l.stageLive).setColor('#D9364F');
      return;
    }
    if (this.status === 'preparing') {
      this.gateLabel.setText(l.gatePreparing).setColor('#A66300');
      this.stageLabel.setText(l.stagePreparing).setColor('#A66300');
      return;
    }
    if (this.status === 'ended') {
      this.gateLabel.setText(l.ended).setColor('#cdd6e0');
      this.stageLabel.setText(l.ended).setColor('#cdd6e0');
      return;
    }
    const label = l.startsIn.replace('{time}', formatClock(remainingMs));
    this.gateLabel
      .setText(this.schedule.isHost() ? l.hostEarly : label)
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

    // Cordone rosso mentre la sala si prepara: il segno che tutti conoscono
    // per «non si passa, ma stanno per aprire». Sostituisce il lucchetto, che
    // direbbe un'altra cosa — chiuso a chiave, torna piu' tardi.
    if (this.status === 'preparing' && open < 0.5) {
      const a = 1 - open * 2;
      const cy = dividerY + 4;
      const sx = gate.centerX - halfGap + 4;
      const dx = gate.centerX + halfGap - 4;
      // Colonnine
      for (const x of [sx, dx]) {
        this.doors.fillStyle(0xb8a06a, a);
        this.doors.fillRoundedRect(x - 3, cy - 20, 6, 26, 2);
        this.doors.fillStyle(0xd8c48c, a);
        this.doors.fillCircle(x, cy - 22, 4);
      }
      // Il cordone, con la sua pancia
      this.doors.lineStyle(4, 0xd9364f, a);
      this.doors.beginPath();
      this.doors.moveTo(sx, cy - 18);
      const passi = 12;
      for (let i = 1; i <= passi; i += 1) {
        const t = i / passi;
        const x = sx + (dx - sx) * t;
        const y = cy - 18 + Math.sin(Math.PI * t) * 9;
        this.doors.lineTo(x, y);
      }
      this.doors.strokePath();
    }

    // Padlock while shut — institutional blue.
    if (this.status !== 'preparing' && open < 0.5) {
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
