import * as Phaser from 'phaser';

import type { LobbyBus } from '../bus';
import type { Luogo } from './WorldMap';

/** Di quanto si allarga il raggio per uscire da un luogo: avvicinarsi al
 *  bordo non fa lampeggiare il pulsante. */
const ISTERESI = 24;

/**
 * I luoghi della piazza dove succede qualcosa: si accorge di quando il
 * personaggio ci arriva vicino (lo dice sul bus, e la pagina mostra il
 * pulsante dell'azione), segnala il luogo con un tondo blu che respira, e
 * disegna gli effetti delle azioni che restano nella scena: la moneta nella
 * fontana o nel pozzo, la festa.
 */
export class Luoghi {
  private attuale: Luogo | null = null;
  private readonly segnale: Phaser.GameObjects.Container;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly luoghi: readonly Luogo[],
    private readonly bus: LobbyBus,
  ) {
    // Un tondo blu .italia con il punto esclamativo, e un alone che respira.
    const alone = scene.add.circle(0, -18, 18, 0x0066cc, 0.25);
    const g = scene.add.graphics();
    g.fillStyle(0x17324d, 0.18);
    g.fillEllipse(0, 2, 22, 7);
    g.fillStyle(0x0066cc, 1);
    g.fillCircle(0, -18, 13);
    g.lineStyle(2, 0xffffff, 1);
    g.strokeCircle(0, -18, 13);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(-2, -26, 4, 10, 2);
    g.fillCircle(0, -12, 2.2);
    this.segnale = scene.add.container(0, 0, [alone, g]).setVisible(false).setDepth(5000);
    scene.tweens.add({ targets: g, y: -5, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    scene.tweens.add({ targets: alone, scale: 1.5, alpha: 0, duration: 1100, repeat: -1 });
  }

  /** Il luogo in cui si trova adesso il personaggio, o null. */
  get vicino(): Luogo | null {
    return this.attuale;
  }

  update(x: number, y: number): void {
    let prossimo: Luogo | null = null;
    let meglio = Number.POSITIVE_INFINITY;
    for (const l of this.luoghi) {
      const d = Math.hypot(l.x - x, l.y - y);
      const raggio = l === this.attuale ? l.raggio + ISTERESI : l.raggio;
      if (d < raggio && d < meglio) {
        prossimo = l;
        meglio = d;
      }
    }
    if (prossimo === this.attuale) return;
    this.attuale = prossimo;
    if (prossimo) this.segnale.setPosition(prossimo.segno.x, prossimo.segno.y).setVisible(true);
    else this.segnale.setVisible(false);
    this.bus.emit('luogo', prossimo?.id ?? null);
  }

  /** Una moneta che vola da chi la lancia al centro del luogo, e lo schizzo. */
  moneta(da: { x: number; y: number }, verso: Luogo): void {
    const coin = this.scene.add.circle(da.x, da.y - 30, 6, 0xf2c230).setStrokeStyle(2, 0xd39420).setDepth(5000);
    const arrivo = { x: verso.x, y: verso.y - 6 };
    const alto = Math.min(da.y, arrivo.y) - 90;
    const t = { p: 0 };
    this.scene.tweens.add({
      targets: t,
      p: 1,
      duration: 650,
      ease: 'Sine.easeIn',
      onUpdate: () => {
        const p = t.p;
        // Una parabola fra partenza, punto alto e arrivo.
        const x = Phaser.Math.Interpolation.QuadraticBezier(p, da.x, (da.x + arrivo.x) / 2, arrivo.x);
        const y = Phaser.Math.Interpolation.QuadraticBezier(p, da.y - 30, alto, arrivo.y);
        coin.setPosition(x, y).setAngle(p * 540);
      },
      onComplete: () => {
        coin.destroy();
        this.schizzo(arrivo.x, arrivo.y);
      },
    });
  }

  private schizzo(x: number, y: number): void {
    for (let i = 0; i < 3; i++) {
      const anello = this.scene.add.ellipse(x, y, 10, 5).setStrokeStyle(3, 0xffffff, 0.9).setDepth(5000);
      this.scene.tweens.add({
        targets: anello,
        scaleX: 6,
        scaleY: 6,
        alpha: 0,
        duration: 900,
        delay: i * 180,
        onComplete: () => anello.destroy(),
      });
    }
  }

  /** Coriandoli intorno a un punto: per un segreto trovato. */
  festa(x: number, y: number): void {
    const colori = [0x0066cc, 0xd9364f, 0x008758, 0xf7a11a, 0x7b5aae, 0xffffff];
    for (let i = 0; i < 48; i++) {
      const c = this.scene.add
        .rectangle(x, y - 40, 7, 4, colori[i % colori.length] ?? 0xffffff)
        .setDepth(5000)
        .setAngle(Math.random() * 90);
      const ang = Math.random() * Math.PI * 2;
      const v = 80 + Math.random() * 160;
      this.scene.tweens.add({
        targets: c,
        x: x + Math.cos(ang) * v,
        y: y - 40 + Math.sin(ang) * v * 0.6 + 120,
        angle: c.angle + 360,
        alpha: 0,
        duration: 1300 + Math.random() * 700,
        ease: 'Quad.easeOut',
        onComplete: () => c.destroy(),
      });
    }
  }

  destroy(): void {
    this.segnale.destroy(true);
  }
}
