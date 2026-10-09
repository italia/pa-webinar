import * as Phaser from 'phaser';

import type { LobbyBus } from '../bus';
import { CODICI_SEGRETI } from '../segreti';
import type { WorldLayout } from './WorldMap';

/** I colori del tricolore e del design system, per coriandoli e fuochi. */
const TRICOLORE = [0x008758, 0xffffff, 0xd9364f];
const COLORI = [0x0066cc, 0xd9364f, 0x008758, 0xf7a11a, 0x7b5aae, 0xffffff];


/** D'inverno, nei giorni di festa, nevica. */
export function nevica(oggi: Date): boolean {
  const m = oggi.getMonth();
  const g = oggi.getDate();
  return (m === 11 && g >= 1) || (m === 0 && g <= 6);
}

function movimentoRidotto(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Le sorprese della piazza: la neve nei giorni di festa d'inverno, i fuochi
 * d'artificio quando il cancello si apre, e i codici segreti da tastiera.
 * Tutto nei colori del design system; con il movimento ridotto niente neve e
 * niente fuochi (i coriandoli restano: li disegna Luoghi, brevi).
 */
export class Atmosfera {
  private readonly ridotto = movimentoRidotto();
  private tasti: string[] = [];
  private readonly onKey: (e: KeyboardEvent) => void;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly layout: WorldLayout,
    private readonly bus: LobbyBus,
    adesso: () => Date = () => new Date(),
  ) {
    if (nevica(adesso()) && !this.ridotto) this.neve(0);
    this.onKey = (e) => this.tasto(e);
    document.addEventListener('keydown', this.onKey);
  }

  /** La neve: per sempre (durata 0) o per qualche millisecondo. */
  private neve(durata: number): void {
    if (this.ridotto) return;
    const { w, h } = this.layout.world;
    const fiocchi: Phaser.GameObjects.Arc[] = [];
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w;
      const fiocco = this.scene.add.circle(x, -10, 2 + Math.random() * 2.5, 0xffffff, 0.9).setDepth(4600);
      fiocchi.push(fiocco);
      const tempo = 9000 + Math.random() * 8000;
      this.scene.tweens.add({
        targets: fiocco,
        y: { from: -10, to: h + 10 },
        x: { from: x, to: x + (Math.random() - 0.5) * 120 },
        duration: tempo,
        delay: durata > 0 ? Math.random() * 3000 : -Math.random() * tempo,
        repeat: -1,
      });
    }
    if (durata > 0) {
      this.scene.time.delayedCall(durata, () => {
        for (const f of fiocchi) {
          this.scene.tweens.killTweensOf(f);
          this.scene.tweens.add({ targets: f, alpha: 0, duration: 1500, onComplete: () => f.destroy() });
        }
      });
    }
  }

  /** Fuochi d'artificio sopra il cancello. */
  fuochi(colori: readonly number[] = COLORI): void {
    if (this.ridotto) return;
    const { gate } = this.layout;
    const punti = [
      [gate.centerX - 260, gate.y - 160],
      [gate.centerX + 260, gate.y - 180],
      [gate.centerX, gate.y - 250],
    ] as const;
    punti.forEach(([x, y], n) => {
      this.scene.time.delayedCall(n * 380, () => this.scoppio(x, y, colori[n % colori.length] ?? 0x0066cc));
    });
  }

  private scoppio(x: number, y: number, colore: number): void {
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2;
      const v = 70 + (i % 3) * 22;
      const bianco = colore === 0xffffff;
      const p = this.scene.add
        .circle(x, y, 4, i % 4 === 0 && !bianco ? 0xffffff : colore, 1)
        .setStrokeStyle(bianco ? 1.5 : 0, 0x17324d, 0.4)
        .setDepth(4700);
      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * v,
        y: y + Math.sin(ang) * v + 30,
        alpha: 0,
        scale: 0.4,
        duration: 1100,
        ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  private tasto(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el instanceof HTMLElement && (/^(input|textarea|select)$/i.test(el.tagName) || el.isContentEditable)) return;
    if (document.querySelector('dialog[open]')) return;
    if (!this.scene.sys.isActive()) return;
    this.tasti.push(e.key.toLowerCase());
    if (this.tasti.length > 12) this.tasti.shift();
    const finisceCon = (codice: readonly string[]) =>
      codice.length <= this.tasti.length && codice.every((k, i) => k === this.tasti[this.tasti.length - codice.length + i]);
    if (finisceCon(CODICI_SEGRETI.festa)) {
      this.tasti = [];
      this.bus.emit('festa');
    } else if (finisceCon(CODICI_SEGRETI.fuochi)) {
      this.tasti = [];
      this.fuochi(TRICOLORE);
    } else if (finisceCon(CODICI_SEGRETI.neve)) {
      this.tasti = [];
      this.neve(60_000);
    }
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
  }
}
