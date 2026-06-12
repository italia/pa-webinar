import * as Phaser from 'phaser';

import { DEPTH } from '../constants';
import type { Collider, WorldLayout } from './WorldMap';

/**
 * "Piazza Digitale" — the .italia waiting-room map.
 *
 * A calm civic square reimagined in flat pastel light: azzurro paving with a
 * faint grid + dotted Bootstrap-Italia texture, white portico "card" bays for
 * the themed zones, a freestanding white portal as the videocall threshold, a
 * clean blue-framed LED facade on a low platform, and a luminous central
 * light-well as the social heart. Predominantly azzurro / blue / white, with
 * tricolore used only as tiny accents.
 *
 * Drop-in alternative to buildPlaceholderMap: returns the SAME WorldLayout
 * contract (spawn / gate / gateTrigger / amphitheatre / garden / screen /
 * seats / staticColliders / gateBar) so every game system keeps working.
 */

// ── Palette (.italia pastel) ──────────────────────────────────────────────────
export const PIAZZA_BG = '#EAF3FB';
const PAVING = 0xd6e8f7; // azzurro chiaro (garden)
const PAVING_ALT = 0xcadff2; // checker tile
const GRID = 0xb7d2ea; // grid + dotted texture
const SAGRATO = 0xf4f7fb; // amphitheatre floor (lighter stone)
const BLUE = 0x0066cc; // primary institutional
const CYAN = 0x3da5dc; // luminous glow
const INK = 0x17324d; // navy ink (text/outlines/shadow)
const WHITE = 0xffffff;
const SHADOW = 0x17324d; // soft shadow (navy, very low alpha)
const CARD_BD = 0xc3d4e6; // card hairline
const GREEN = 0x008758; // tricolore accent (sparing)
const RED = 0xd9364f; // tricolore accent (sparing)

const LABEL_FONT = 'Titillium Web, system-ui, sans-serif';

/** Reusable airy shadow: ONE navy ellipse at very low alpha (never black). */
function softShadow(g: Phaser.GameObjects.Graphics, x: number, y: number, rx: number, a = 0.1): void {
  g.fillStyle(SHADOW, a);
  g.fillEllipse(x, y + 6, rx * 2, rx * 0.55);
}

function signPill(scene: Phaser.Scene, x: number, y: number, label: string, depth: number): void {
  const padW = 12 + label.length * 7.2;
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(BLUE, 1);
  g.fillRoundedRect(x - padW / 2, y - 13, padW, 26, 8);
  g.lineStyle(1.5, INK, 0.25);
  g.strokeRoundedRect(x - padW / 2, y - 13, padW, 26, 8);
  scene.add
    .text(x, y, label, { fontFamily: LABEL_FONT, fontSize: '14px', fontStyle: '600', color: '#ffffff' })
    .setOrigin(0.5)
    .setDepth(depth + 1);
}

function planter(g: Phaser.GameObjects.Graphics, x: number, y: number, r = 24): Collider {
  softShadow(g, x, y, r);
  g.fillStyle(GREEN, 0.72); // soft topiary
  g.fillCircle(x, y - 18, r);
  g.fillStyle(0x37a06b, 0.5); // highlight
  g.fillCircle(x - r * 0.3, y - 22, r * 0.55);
  g.fillStyle(PAVING_ALT, 1); // azzurro ceramic pot
  g.fillRoundedRect(x - r * 0.7, y - 6, r * 1.4, 16, 5);
  g.fillStyle(GRID, 1);
  g.fillRect(x - r * 0.7, y - 6, r * 1.4, 3);
  return { kind: 'circle', x, y, r: r * 0.8 };
}

function bench(g: Phaser.GameObjects.Graphics, x: number, y: number): Collider {
  softShadow(g, x, y, 26);
  g.fillStyle(WHITE, 1);
  g.fillRoundedRect(x - 26, y - 8, 52, 14, 8);
  g.lineStyle(1.5, CARD_BD, 1);
  g.strokeRoundedRect(x - 26, y - 8, 52, 14, 8);
  g.fillStyle(BLUE, 0.25);
  g.fillRect(x - 24, y - 7, 48, 2);
  return { kind: 'rect', rect: new Phaser.Geom.Rectangle(x - 26, y - 8, 52, 16) };
}

export function buildPiazzaMap(
  scene: Phaser.Scene,
  world: { w: number; h: number },
): WorldLayout {
  const w = world.w;
  const h = world.h;
  const gateCx = Math.round(w / 2);
  const dividerY = Math.round(h * 0.3);

  scene.cameras.main.setBackgroundColor(PIAZZA_BG);

  const amphitheatre = new Phaser.Geom.Rectangle(0, 0, w, dividerY);
  const garden = new Phaser.Geom.Rectangle(0, dividerY, w, h - dividerY);
  const gate = new Phaser.Geom.Rectangle(gateCx - 100, dividerY - 21, 200, 42);
  const gateTrigger = new Phaser.Geom.Rectangle(gateCx - 116, dividerY + 15, 232, 120);
  const screen = new Phaser.Geom.Rectangle(gateCx - 260, 56, 520, 130);

  const staticColliders: Collider[] = [];

  // ── STEP 1 — Ground ──
  const ground = scene.add.graphics().setDepth(DEPTH.GROUND);
  ground.fillStyle(SAGRATO, 1);
  ground.fillRect(0, 0, w, dividerY);
  ground.fillStyle(PAVING, 1);
  ground.fillRect(0, dividerY, w, h - dividerY);

  // ── STEP 2 — Paving texture (checker + grid + dotted .italia) ──
  const tex = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL);
  const TILE = 80;
  for (let row = 0, gy = dividerY; gy < h; gy += TILE, row++) {
    for (let col = 0, gx = 0; gx < w; gx += TILE, col++) {
      if ((col + row) % 2 === 0) {
        tex.fillStyle(PAVING_ALT, 1);
        tex.fillRect(gx, gy, TILE, TILE);
      }
    }
  }
  tex.lineStyle(1, GRID, 0.5);
  for (let gx = 0; gx <= w; gx += TILE) tex.lineBetween(gx, dividerY, gx, h);
  for (let gy = dividerY; gy <= h; gy += TILE) tex.lineBetween(0, gy, w, gy);
  // Dotted Bootstrap-Italia accent.
  tex.fillStyle(GRID, 0.5);
  for (let gy = dividerY + 20; gy < h; gy += 40)
    for (let gx = 20; gx < w; gx += 40) tex.fillCircle(gx, gy, 1.3);
  // Sagrato inlaid guide line (light-well → portal → screen).
  tex.lineStyle(2, BLUE, 0.8);
  tex.lineBetween(gateCx, screen.bottom, gateCx, dividerY);
  tex.lineBetween(gateCx, dividerY, gateCx, Math.round(h * 0.62));

  // ── STEP 4 — LED facade (focal screen on a low platform) ──
  const stage = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 2);
  softShadow(stage, screen.centerX, screen.bottom + 6, 290, 0.12);
  stage.fillStyle(WHITE, 1); // platform
  stage.fillRoundedRect(screen.x - 40, screen.bottom - 6, screen.width + 80, 40, 16);
  stage.fillStyle(INK, 1); // facade body
  stage.fillRoundedRect(screen.x - 8, screen.y - 8, screen.width + 16, screen.height + 16, 12);
  stage.fillGradientStyle(BLUE, BLUE, CYAN, CYAN, 0.4);
  stage.fillRoundedRect(screen.x, screen.y, screen.width, screen.height, 8);
  stage.lineStyle(3, BLUE, 1);
  stage.strokeRoundedRect(screen.x - 8, screen.y - 8, screen.width + 16, screen.height + 16, 12);
  // faint loggia step arcs behind the seats
  stage.lineStyle(2, 0xcfe3f7, 0.7);
  for (const r of [560, 470, 380]) stage.strokeCircle(gateCx, screen.bottom + 40, r);

  // ── STEP 5 — Portal gate (white arch + planters + sign) ──
  const portal = scene.add.graphics().setDepth(dividerY + 1);
  softShadow(portal, gateCx, dividerY + 2, 120, 0.12);
  const pillarH = 74;
  for (const px of [gate.x - 8, gate.right - 8]) {
    portal.fillStyle(WHITE, 1);
    portal.fillRoundedRect(px, dividerY - pillarH, 16, pillarH + 12, 5);
    portal.lineStyle(1.5, CARD_BD, 1);
    portal.strokeRoundedRect(px, dividerY - pillarH, 16, pillarH + 12, 5);
  }
  portal.fillStyle(WHITE, 1); // lintel (flat arch)
  portal.fillRoundedRect(gate.x - 14, dividerY - pillarH - 10, gate.width + 28, 24, 12);
  portal.fillStyle(SAGRATO, 1);
  portal.fillRoundedRect(gate.x - 8, dividerY - pillarH - 4, gate.width + 16, 10, 6);
  portal.lineStyle(1.5, CARD_BD, 1);
  portal.strokeRoundedRect(gate.x - 14, dividerY - pillarH - 10, gate.width + 28, 24, 12);
  // flanking low planters (instead of a hedge)
  staticColliders.push(planter(portal, gate.x - 40, dividerY, 18));
  staticColliders.push(planter(portal, gate.right + 24, dividerY, 18));
  signPill(scene, gateCx, dividerY - pillarH - 28, 'Ingresso videochiamata', dividerY + 4);

  const gateBar: Collider = {
    kind: 'rect',
    rect: new Phaser.Geom.Rectangle(gate.x, dividerY - 15, gate.width, 30),
  };

  // ── STEP 6 — Amphitheatre seats (white bench chips) ──
  const seatG = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 1);
  const seats: { x: number; y: number }[] = [];
  const rows = [
    { r: 240, n: 8, y: screen.bottom + 96 },
    { r: 340, n: 12, y: screen.bottom + 150 },
    { r: 450, n: 16, y: screen.bottom + 200 },
    { r: 560, n: 20, y: screen.bottom + 248 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0.5 : i / (row.n - 1);
      const ang = (-1 + 2 * t) * 0.82;
      const sx = gateCx + Math.sin(ang) * row.r;
      const sy = row.y + (1 - Math.cos(ang)) * 24;
      if (Math.abs(sx - gateCx) < 70) continue; // keep the central aisle clear
      seats.push({ x: sx, y: sy });
      seatG.fillStyle(WHITE, 1);
      seatG.fillRoundedRect(sx - 12, sy - 13, 24, 16, 5);
      seatG.fillStyle(BLUE, 0.85);
      seatG.fillRect(sx - 12, sy - 13, 24, 2);
    }
  }

  // ── STEP 7 — Zone bays (soft white cards) ──
  const zone = (
    x: number,
    y: number,
    title: string,
    draw: (g: Phaser.GameObjects.Graphics) => void,
  ): void => {
    const g = scene.add.graphics().setDepth(y);
    const cw = 150;
    const ch = 92;
    softShadow(g, x, y + 14, 86, 0.12);
    g.fillStyle(WHITE, 1);
    g.fillRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
    g.lineStyle(1.5, CARD_BD, 1);
    g.strokeRoundedRect(x - cw / 2, y - ch / 2, cw, ch, 14);
    draw(g);
    signPill(scene, x, y - ch / 2 - 4, title, y + 2);
    staticColliders.push({
      kind: 'rect',
      rect: new Phaser.Geom.Rectangle(x - cw / 2, y - ch / 2, cw, ch),
    });
  };

  zone(w * 0.18, h * 0.55, 'Caffè', (g) => {
    const x = w * 0.18;
    const y = h * 0.55;
    g.fillStyle(PAVING_ALT, 1); // cup
    g.fillRoundedRect(x - 18, y - 10, 30, 22, 6);
    g.lineStyle(2.5, BLUE, 1);
    g.strokeRoundedRect(x - 18, y - 10, 30, 22, 6);
    g.lineStyle(2.5, BLUE, 1);
    g.strokeCircle(x + 18, y, 7); // handle
    g.lineStyle(2, CYAN, 0.8); // steam
    g.lineBetween(x - 6, y - 18, x - 6, y - 26);
    g.lineBetween(x + 4, y - 18, x + 4, y - 28);
  });
  zone(w * 0.82, h * 0.55, 'Operazioni', (g) => {
    const x = w * 0.82;
    const y = h * 0.55;
    for (let i = 0; i < 3; i++) {
      const by = y - 16 + i * 13;
      g.fillStyle(PAVING_ALT, 1);
      g.fillRoundedRect(x - 24, by, 48, 10, 3);
      g.lineStyle(2, BLUE, 0.9);
      g.strokeRoundedRect(x - 24, by, 48, 10, 3);
      g.fillStyle(i === 0 ? GREEN : CYAN, 1); // steady status dot
      g.fillCircle(x + 16, by + 5, 2.4);
    }
  });
  zone(w * 0.18, h * 0.84, 'Design', (g) => {
    const x = w * 0.18;
    const y = h * 0.84;
    const cols = [BLUE, GREEN, RED];
    for (let i = 0; i < 3; i++) {
      g.fillStyle(WHITE, 1);
      g.fillRoundedRect(x - 36 + i * 26, y - 14, 22, 28, 4);
      g.lineStyle(1.5, CARD_BD, 1);
      g.strokeRoundedRect(x - 36 + i * 26, y - 14, 22, 28, 4);
      g.fillStyle(cols[i] ?? BLUE, 1);
      g.fillCircle(x - 25 + i * 26, y - 2, 6);
    }
  });
  zone(w * 0.82, h * 0.84, 'Sviluppo', (g) => {
    const x = w * 0.82;
    const y = h * 0.84;
    g.fillStyle(PAVING_ALT, 1);
    g.fillRoundedRect(x - 30, y - 16, 60, 32, 6);
    g.lineStyle(1.5, CARD_BD, 1);
    g.strokeRoundedRect(x - 30, y - 16, 60, 32, 6);
    scene.add
      .text(x, y, '</>', { fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: '#17324d' })
      .setOrigin(0.5)
      .setDepth(h * 0.84 + 1);
  });

  // ── STEP 8 — Central light-well (WOW) ──
  const wellY = Math.round(h * 0.62);
  const well = scene.add.graphics().setDepth(wellY);
  softShadow(well, gateCx, wellY, 64, 0.1);
  well.lineStyle(2, 0x9dc4ee, 0.9);
  well.strokeCircle(gateCx, wellY, 64);
  well.lineStyle(2, CYAN, 0.7);
  well.strokeCircle(gateCx, wellY, 48);
  well.fillGradientStyle(CYAN, CYAN, PAVING, PAVING, 0.55);
  well.fillCircle(gateCx, wellY, 28);
  well.fillStyle(WHITE, 0.5);
  well.fillCircle(gateCx - 6, wellY - 6, 6);
  staticColliders.push({ kind: 'circle', x: gateCx, y: wellY, r: 58 });

  // ── STEP 9 — Benches + planters (soft walk-around obstacles) ──
  const props = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 3);
  staticColliders.push(bench(props, gateCx - 150, wellY + 70));
  staticColliders.push(bench(props, gateCx + 150, wellY + 70));
  for (const t of [
    { x: w * 0.05, y: h * 0.74 },
    { x: w * 0.95, y: h * 0.74 },
    { x: gateCx, y: h * 0.97 },
  ]) {
    const g = scene.add.graphics().setDepth(t.y);
    staticColliders.push(planter(g, t.x, t.y, 24));
  }

  return {
    world,
    garden,
    amphitheatre,
    gate,
    gateTrigger,
    screen,
    spawn: { x: gateCx, y: dividerY + 230 },
    seats,
    staticColliders,
    gateBar,
  };
}
