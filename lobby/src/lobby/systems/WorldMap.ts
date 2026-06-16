import * as Phaser from 'phaser';

import { DEPTH } from '../constants';

/**
 * Programmatic placeholder world — same zone rectangles a real Tiled (.tmj) map
 * would expose, so swapping to a loaded tilemap (AssetConfig.tilemapUrl) touches
 * only this file.
 *
 * Layout (top → bottom):
 *  - a THEATRE behind the hedge: curtained stage + an LED wall + rows of seats,
 *    reached through a clearly-signed gate (the videocall entrance);
 *  - a GARDEN organised into themed zones — a coffee kiosk, a server farm (ops),
 *    a design studio (designers) and a build site (developers) — joined by paths,
 *    with the player spawning near the wall so the entrance is obvious.
 * Everything y-sorts (depth = baseline y); the ground sits at DEPTH.GROUND.
 */

export type Collider =
  | { kind: 'rect'; rect: Phaser.Geom.Rectangle }
  | { kind: 'circle'; x: number; y: number; r: number };

export interface WorldLayout {
  world: { w: number; h: number };
  garden: Phaser.Geom.Rectangle;
  amphitheatre: Phaser.Geom.Rectangle;
  gate: Phaser.Geom.Rectangle;
  gateTrigger: Phaser.Geom.Rectangle;
  screen: Phaser.Geom.Rectangle;
  spawn: { x: number; y: number };
  seats: { x: number; y: number }[];
  staticColliders: Collider[];
  gateBar: Collider;
}

const GRASS = 0x4a8a3f;
const GRASS_DARK = 0x3f7d3a;
const GRASS_LIGHT = 0x57a049;
const PATH = 0xc7a878;
const PATH_DARK = 0xb2966a;
const CARPET = 0x5a2433;
const CARPET_DARK = 0x4a1d2b;
const CARPET_RUNNER = 0x7a1f2e;
const STAGE_WOOD = 0x6b4a2e;
const STAGE_WOOD_TOP = 0x8a6238;
const CURTAIN = 0x9e1b2e;
const CURTAIN_DARK = 0x771122;
const CURTAIN_LIGHT = 0xc23044;
const GOLD = 0xe6b800;
const STONE = 0x9098a3;
const STONE_DARK = 0x7a828d;
const HEDGE = 0x2f5d2b;
const HEDGE_DARK = 0x244a22;
const WATER = 0x3aa0d8;
const TRUNK = 0x6b4a2a;
const FOLIAGE = 0x2e6e2c;
const CHAIR = 0x8a2233;
const CHAIR_DARK = 0x6a1827;

export function buildPlaceholderMap(
  scene: Phaser.Scene,
  world: { w: number; h: number },
): WorldLayout {
  const w = world.w;
  const h = world.h;
  const dividerY = Math.round(h * 0.34);
  const hedgeThick = 30;
  const gateHalf = 100;
  const gateCx = Math.round(w / 2);

  const amphitheatre = new Phaser.Geom.Rectangle(0, 0, w, dividerY);
  const garden = new Phaser.Geom.Rectangle(0, dividerY, w, h - dividerY);
  const gate = new Phaser.Geom.Rectangle(
    gateCx - gateHalf,
    dividerY - hedgeThick / 2 - 6,
    gateHalf * 2,
    hedgeThick + 12,
  );
  const gateTrigger = new Phaser.Geom.Rectangle(
    gateCx - gateHalf - 16,
    dividerY + hedgeThick / 2,
    gateHalf * 2 + 32,
    110,
  );
  const screen = new Phaser.Geom.Rectangle(gateCx - 190, 40, 380, 104);

  // ── Ground ──
  const ground = scene.add.graphics().setDepth(DEPTH.GROUND);
  ground.fillStyle(CARPET, 1);
  ground.fillRect(0, 0, w, dividerY);
  ground.fillStyle(GRASS, 1);
  ground.fillRect(0, dividerY, w, h - dividerY);

  const detail = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL);
  // Garden paths: a central avenue to the gate + cross paths to the zones.
  detail.fillStyle(PATH, 1);
  detail.fillRect(gateCx - 52, dividerY, 104, h - dividerY); // central avenue
  detail.fillRect(0, h * 0.6 - 34, w, 68); // upper cross path
  detail.fillRect(0, h * 0.86 - 34, w, 68); // lower cross path
  detail.fillStyle(PATH_DARK, 0.5);
  detail.fillRect(gateCx - 52, dividerY, 6, h - dividerY);
  detail.fillRect(gateCx + 46, dividerY, 6, h - dividerY);
  // Grass patches.
  for (let i = 0; i < 80; i++) {
    const px = ((i * 9301 + 49297) % 233280) / 233280;
    const py = ((i * 49297 + 9301) % 233280) / 233280;
    detail.fillStyle(i % 2 === 0 ? GRASS_LIGHT : GRASS_DARK, 0.35);
    detail.fillEllipse(px * w, dividerY + py * (h - dividerY), 24 + (i % 5) * 6, 12 + (i % 3) * 4);
  }
  // Theatre carpet runner up the centre aisle.
  detail.fillStyle(CARPET_RUNNER, 1);
  detail.fillRect(gateCx - 60, 150, 120, dividerY - 150);
  detail.fillStyle(CARPET_DARK, 1);
  for (let y = 170; y < dividerY; y += 26) detail.fillRect(gateCx - 60, y, 120, 3);

  const staticColliders: Collider[] = [];

  // ── Theatre ──
  drawAuditoriumSeats(scene, gateCx, screen.bottom, dividerY);
  drawStage(scene, gateCx, screen);

  // ── Hedge + grand, signed gate ──
  const drawHedge = (x: number, segW: number): void => {
    const g = scene.add.graphics();
    g.fillStyle(HEDGE_DARK, 1);
    g.fillRoundedRect(x, dividerY - hedgeThick / 2 + 3, segW, hedgeThick, 8);
    g.fillStyle(HEDGE, 1);
    g.fillRoundedRect(x, dividerY - hedgeThick / 2, segW, hedgeThick - 4, 8);
    g.setDepth(dividerY);
    staticColliders.push({
      kind: 'rect',
      rect: new Phaser.Geom.Rectangle(x, dividerY - hedgeThick / 2, segW, hedgeThick),
    });
  };
  drawHedge(0, gateCx - gateHalf);
  drawHedge(gateCx + gateHalf, w - (gateCx + gateHalf));

  const posts = scene.add.graphics().setDepth(dividerY + 1);
  for (const px of [gate.x - 16, gate.right + 4]) {
    posts.fillStyle(STONE_DARK, 1);
    posts.fillRoundedRect(px, dividerY - 64, 14, 94, 4);
    posts.fillStyle(STONE, 1);
    posts.fillRoundedRect(px + 2, dividerY - 62, 10, 90, 3);
    posts.fillStyle(GOLD, 0.85);
    posts.fillRoundedRect(px - 2, dividerY - 70, 18, 6, 2);
  }
  // Banner over the gate marking the entrance.
  const banner = scene.add.graphics().setDepth(dividerY + 2);
  banner.fillStyle(0x14304a, 1);
  banner.fillRoundedRect(gateCx - 150, dividerY - 96, 300, 30, 6);
  banner.lineStyle(2, GOLD, 0.8);
  banner.strokeRoundedRect(gateCx - 150, dividerY - 96, 300, 30, 6);
  scene.add
    .text(gateCx, dividerY - 81, '🎬  INGRESSO VIDEOCALL', {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '15px',
      fontStyle: 'bold',
      color: '#eaf6ff',
    })
    .setOrigin(0.5)
    .setDepth(dividerY + 3);

  const gateBar: Collider = {
    kind: 'rect',
    rect: new Phaser.Geom.Rectangle(gate.x, dividerY - hedgeThick / 2, gate.width, hedgeThick),
  };

  // ── Garden: central plaza + 4 themed zones ──
  staticColliders.push(drawFountain(scene, gateCx, Math.round(h * 0.74), 52));
  staticColliders.push(drawTux(scene, gateCx + 120, h * 0.74)); // open-source mascot in the plaza

  pushAll(staticColliders, drawCoffeeKiosk(scene, w * 0.2, h * 0.6));
  pushAll(staticColliders, drawServerFarm(scene, w * 0.8, h * 0.6));
  pushAll(staticColliders, drawDesignStudio(scene, w * 0.2, h * 0.86));
  pushAll(staticColliders, drawBuildSite(scene, w * 0.8, h * 0.86));

  for (const t of [
    { x: w * 0.05, y: h * 0.74, r: 26 },
    { x: w * 0.95, y: h * 0.74, r: 26 },
    { x: gateCx, y: h * 0.97, r: 24 },
  ]) {
    staticColliders.push(drawTree(scene, t.x, t.y, t.r));
  }

  // ── inCall seats (front rows) ──
  const seats: { x: number; y: number }[] = [];
  const rows = [
    { r: 215, n: 8, y: screen.bottom + 92 },
    { r: 310, n: 12, y: screen.bottom + 150 },
    { r: 410, n: 16, y: screen.bottom + 200 },
  ];
  for (const row of rows) {
    for (let i = 0; i < row.n; i++) {
      const t = row.n === 1 ? 0.5 : i / (row.n - 1);
      const ang = (-1 + 2 * t) * 0.82;
      seats.push({ x: gateCx + Math.sin(ang) * row.r, y: row.y + (1 - Math.cos(ang)) * 24 });
    }
  }

  return {
    world,
    garden,
    amphitheatre,
    gate,
    gateTrigger,
    screen,
    // Spawn near the wall so the gate / entrance is on screen from the start.
    spawn: { x: gateCx, y: dividerY + 210 },
    seats,
    staticColliders,
    gateBar,
  };
}

function pushAll(target: Collider[], more: Collider[]): void {
  for (const c of more) target.push(c);
}

// ── Theatre ──────────────────────────────────────────────────────────────────
function drawAuditoriumSeats(
  scene: Phaser.Scene,
  cx: number,
  stageBottom: number,
  dividerY: number,
): void {
  const g = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 1);
  // Rows of empty theatre chairs curving toward the stage, filling the hall so
  // the area past the wall clearly reads as an auditorium.
  let row = 0;
  for (let ry = stageBottom + 60; ry < dividerY - 26; ry += 46) {
    const radius = 150 + row * 70;
    const count = 8 + row * 4;
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const ang = (-1 + 2 * t) * 0.92;
      const sx = cx + Math.sin(ang) * radius;
      const sy = ry + (1 - Math.cos(ang)) * 20;
      if (Math.abs(sx - cx) < 66) continue; // keep the central aisle clear
      g.fillStyle(CHAIR_DARK, 1);
      g.fillRoundedRect(sx - 11, sy - 14, 22, 18, 4); // seat back
      g.fillStyle(CHAIR, 1);
      g.fillRoundedRect(sx - 11, sy - 4, 22, 8, 3); // seat
    }
    row++;
  }
}

function drawStage(scene: Phaser.Scene, cx: number, screen: Phaser.Geom.Rectangle): void {
  const g = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 2);
  const halfW = 430;
  const stageTop = 14;
  const stageBottom = 180;

  g.fillStyle(0x201018, 1);
  g.fillRect(cx - halfW - 10, 0, (halfW + 10) * 2, stageTop + 8);

  g.fillStyle(STAGE_WOOD, 1);
  g.fillRect(cx - halfW, stageTop, halfW * 2, stageBottom - stageTop);
  g.fillStyle(STAGE_WOOD_TOP, 1);
  g.fillRect(cx - halfW, stageTop, halfW * 2, 8);
  g.lineStyle(2, 0x000000, 0.2);
  for (let x = cx - halfW; x <= cx + halfW; x += 48) g.lineBetween(x, stageTop, x, stageBottom);
  g.fillStyle(GOLD, 0.85);
  g.fillRect(cx - halfW, stageBottom - 6, halfW * 2, 6);

  g.fillStyle(0xfff3c0, 0.1);
  g.fillTriangle(cx - 260, 0, cx - 320, 0, cx - 30, stageBottom);
  g.fillTriangle(cx + 260, 0, cx + 320, 0, cx + 30, stageBottom);

  g.fillStyle(0x0a0f1a, 1);
  g.fillRoundedRect(screen.x - 8, screen.y - 8, screen.width + 16, screen.height + 16, 8);
  g.lineStyle(3, 0x0066CC, 0.7);
  g.strokeRoundedRect(screen.x - 8, screen.y - 8, screen.width + 16, screen.height + 16, 8);

  drawCurtain(g, cx - halfW + 6, 10, screen.x - 16 - (cx - halfW + 6), stageBottom);
  drawCurtain(g, screen.right + 16, 10, cx + halfW - 6 - (screen.right + 16), stageBottom);
  g.fillStyle(CURTAIN_DARK, 1);
  g.fillRect(cx - halfW + 6, 10, halfW * 2 - 12, 22);
  g.fillStyle(GOLD, 0.9);
  for (let i = 0; i < 26; i++) {
    g.fillCircle(cx - halfW + 18 + i * ((halfW * 2 - 30) / 25), 32, 4);
  }

  // Podium.
  g.fillStyle(0x3a2a1c, 1);
  g.fillRoundedRect(cx - 16, stageBottom - 34, 32, 30, 3);
  g.fillStyle(0x55402b, 1);
  g.fillRoundedRect(cx - 20, stageBottom - 40, 40, 10, 3);
  g.fillStyle(0x0066CC, 0.5);
  g.fillRoundedRect(cx - 14, stageBottom - 38, 28, 5, 2);
}

function drawCurtain(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  bottom: number,
): void {
  if (width <= 0) return;
  const folds = Math.max(3, Math.round(width / 26));
  const fw = width / folds;
  for (let i = 0; i < folds; i++) {
    g.fillStyle(i % 2 === 0 ? CURTAIN : CURTAIN_DARK, 1);
    g.fillRect(x + i * fw, y, fw + 1, bottom - y);
    g.fillStyle(CURTAIN_LIGHT, 0.5);
    g.fillRect(x + i * fw + fw * 0.3, y, 2, bottom - y);
  }
}

// ── Shared prop helpers ──────────────────────────────────────────────────────
function shadow(g: Phaser.GameObjects.Graphics, x: number, y: number, rx: number): void {
  g.fillStyle(0x000000, 0.18);
  g.fillEllipse(x, y + 4, rx * 2, rx * 0.6);
}

function signpost(scene: Phaser.Scene, x: number, y: number, label: string): void {
  const g = scene.add.graphics().setDepth(y + 60);
  g.fillStyle(0x14304a, 0.92);
  g.fillRoundedRect(x - 74, y - 12, 148, 26, 6);
  g.lineStyle(2, GOLD, 0.7);
  g.strokeRoundedRect(x - 74, y - 12, 148, 26, 6);
  scene.add
    .text(x, y + 1, label, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#eaf6ff',
    })
    .setOrigin(0.5)
    .setDepth(y + 61);
}

function rug(g: Phaser.GameObjects.Graphics, x: number, y: number, rw: number, rh: number, c: number): void {
  g.fillStyle(c, 0.5);
  g.fillEllipse(x, y, rw, rh);
}

function drawTree(scene: Phaser.Scene, x: number, y: number, r: number): Collider {
  const g = scene.add.graphics().setDepth(y);
  shadow(g, x, y, r);
  g.fillStyle(TRUNK, 1);
  g.fillRoundedRect(x - 5, y - 6, 10, 18, 3);
  g.fillStyle(FOLIAGE, 1);
  g.fillCircle(x, y - 18, r);
  g.fillStyle(0x3a8a37, 1);
  g.fillCircle(x - r * 0.3, y - 22, r * 0.7);
  return { kind: 'circle', x, y, r: r * 0.55 };
}

function drawFountain(scene: Phaser.Scene, x: number, y: number, r: number): Collider {
  const g = scene.add.graphics().setDepth(y);
  g.fillStyle(STONE_DARK, 1);
  g.fillCircle(x, y, r);
  g.fillStyle(STONE, 1);
  g.fillCircle(x, y, r - 7);
  g.fillStyle(WATER, 1);
  g.fillCircle(x, y, r - 16);
  g.fillStyle(0x66c0e8, 0.8);
  g.fillCircle(x, y - 4, r * 0.18);
  return { kind: 'circle', x, y, r: r - 4 };
}

function drawTux(scene: Phaser.Scene, x: number, y: number): Collider {
  const g = scene.add.graphics().setDepth(y);
  shadow(g, x, y, 22);
  g.fillStyle(PATH_DARK, 1);
  g.fillRoundedRect(x - 22, y - 14, 44, 16, 4);
  const by = y - 18;
  g.fillStyle(0x1a1a22, 1);
  g.fillEllipse(x, by - 16, 42, 54);
  g.fillStyle(0xf4f4f6, 1);
  g.fillEllipse(x, by - 11, 28, 40);
  g.fillStyle(0x1a1a22, 1);
  g.fillCircle(x, by - 40, 15);
  g.fillStyle(0xf4f4f6, 1);
  g.fillCircle(x - 5, by - 42, 5);
  g.fillCircle(x + 5, by - 42, 5);
  g.fillStyle(0x111118, 1);
  g.fillCircle(x - 4, by - 42, 2.2);
  g.fillCircle(x + 4, by - 42, 2.2);
  g.fillStyle(0xf6a623, 1);
  g.fillTriangle(x - 5, by - 36, x + 5, by - 36, x, by - 31);
  g.fillEllipse(x - 8, by + 6, 12, 6);
  g.fillEllipse(x + 8, by + 6, 12, 6);
  return { kind: 'circle', x, y, r: 22 };
}

// ── Themed zones ─────────────────────────────────────────────────────────────
function drawCoffeeKiosk(scene: Phaser.Scene, x: number, y: number): Collider[] {
  const g = scene.add.graphics().setDepth(y);
  rug(g, x, y + 30, 200, 90, 0x8a6a40);
  shadow(g, x, y, 70);
  // Counter + awning booth.
  g.fillStyle(0x5b3b22, 1);
  g.fillRoundedRect(x - 64, y - 30, 128, 34, 4); // counter
  g.fillStyle(0x7a5230, 1);
  g.fillRoundedRect(x - 64, y - 30, 128, 8, 3);
  // Striped awning.
  for (let i = 0; i < 8; i++) {
    g.fillStyle(i % 2 === 0 ? 0xd64545 : 0xf4f4f4, 1);
    g.fillRect(x - 70 + i * 17.5, y - 58, 17.5, 16);
  }
  g.fillStyle(0x3a2a1c, 1);
  g.fillRect(x - 70, y - 44, 140, 4);
  // Coffee machine + cups + steam.
  g.fillStyle(0xb0b6bf, 1);
  g.fillRoundedRect(x + 18, y - 50, 26, 22, 3);
  g.fillStyle(0x0066CC, 0.7);
  g.fillCircle(x + 31, y - 41, 3);
  for (let i = 0; i < 3; i++) {
    g.fillStyle(0xf4f4f4, 1);
    g.fillRoundedRect(x - 48 + i * 16, y - 40, 10, 10, 2);
    g.fillStyle(0x6b4226, 1);
    g.fillRoundedRect(x - 47 + i * 16, y - 39, 8, 3, 1);
  }
  g.fillStyle(0xffffff, 0.35);
  g.fillCircle(x + 31, y - 58, 4);
  g.fillCircle(x + 34, y - 66, 3);
  signpost(scene, x, y - 84, '☕  Caffè');
  return [{ kind: 'rect', rect: new Phaser.Geom.Rectangle(x - 66, y - 32, 132, 40) }];
}

function drawServerFarm(scene: Phaser.Scene, x: number, y: number): Collider[] {
  const g = scene.add.graphics().setDepth(y);
  rug(g, x, y + 24, 220, 96, 0x445066);
  const colliders: Collider[] = [];
  const rackXs = [x - 70, x - 24, x + 22, x + 68];
  for (const rx of rackXs) {
    shadow(g, rx, y, 18);
    const top = y - 70;
    g.fillStyle(0x2a2f3a, 1);
    g.fillRoundedRect(rx - 17, top, 34, 60, 4);
    g.fillStyle(0x1b1f27, 1);
    g.fillRoundedRect(rx - 14, top + 3, 28, 54, 3);
    for (let i = 0; i < 5; i++) {
      const uy = top + 6 + i * 10;
      g.fillStyle(0x10141b, 1);
      g.fillRoundedRect(rx - 12, uy, 24, 7, 2);
      g.fillStyle(i % 2 === 0 ? 0x49e07a : 0xf2b134, 1);
      g.fillCircle(rx - 8, uy + 3.5, 1.6);
      g.fillStyle(0x49e07a, 1);
      g.fillCircle(rx - 4, uy + 3.5, 1.6);
    }
    colliders.push({ kind: 'rect', rect: new Phaser.Geom.Rectangle(rx - 17, y - 70, 34, 74) });
  }
  signpost(scene, x, y - 86, '🖥️  Server');
  return colliders;
}

function drawDesignStudio(scene: Phaser.Scene, x: number, y: number): Collider[] {
  const g = scene.add.graphics().setDepth(y);
  rug(g, x, y + 22, 210, 92, 0x6a5a8a);
  const colliders: Collider[] = [];
  const easels = [
    { ex: x - 60, c: 0xd64545 },
    { ex: x, c: 0x3a8ad6 },
    { ex: x + 60, c: 0x49b06a },
  ];
  for (const e of easels) {
    shadow(g, e.ex, y, 20);
    // Tripod legs.
    g.lineStyle(4, 0x6b4a2a, 1);
    g.lineBetween(e.ex, y - 8, e.ex - 12, y + 6);
    g.lineBetween(e.ex, y - 8, e.ex + 12, y + 6);
    g.lineBetween(e.ex, y - 8, e.ex, y + 8);
    // Canvas.
    g.fillStyle(0xf4f1e8, 1);
    g.fillRoundedRect(e.ex - 18, y - 56, 36, 44, 3);
    g.fillStyle(e.c, 1);
    g.fillCircle(e.ex - 4, y - 38, 8);
    g.fillStyle(0xf2c12e, 1);
    g.fillRect(e.ex - 2, y - 30, 16, 6);
    colliders.push({ kind: 'circle', x: e.ex, y, r: 18 });
  }
  // Palette.
  g.fillStyle(0x9a6b3a, 1);
  g.fillEllipse(x + 96, y - 6, 34, 22);
  for (let i = 0; i < 4; i++) {
    g.fillStyle([0xd64545, 0x3a8ad6, 0x49b06a, 0xf2c12e][i] ?? 0xffffff, 1);
    g.fillCircle(x + 86 + i * 7, y - 8, 3);
  }
  colliders.push({ kind: 'circle', x: x + 96, y: y - 6, r: 16 });
  signpost(scene, x, y - 78, '🎨  Design');
  return colliders;
}

function drawBuildSite(scene: Phaser.Scene, x: number, y: number): Collider[] {
  const g = scene.add.graphics().setDepth(y);
  rug(g, x, y + 22, 220, 96, 0x7a6a45);
  const colliders: Collider[] = [];
  // Scaffolding frame.
  shadow(g, x - 40, y, 26);
  g.lineStyle(5, 0xc9a227, 1);
  g.strokeRect(x - 68, y - 70, 56, 74);
  g.lineBetween(x - 68, y - 44, x - 12, y - 44);
  g.lineBetween(x - 68, y - 18, x - 12, y - 18);
  g.lineBetween(x - 40, y - 70, x - 40, y + 4);
  // Brick stack (being built).
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      g.fillStyle(0xc0612e, 1);
      g.fillRoundedRect(x - 58 + c * 15 + (r % 2) * 4, y - 16 - r * 9, 13, 7, 1);
    }
  colliders.push({ kind: 'rect', rect: new Phaser.Geom.Rectangle(x - 70, y - 72, 60, 78) });
  // </> code blocks crane.
  shadow(g, x + 50, y, 22);
  g.fillStyle(0x4a5160, 1);
  g.fillRoundedRect(x + 36, y - 6, 30, 10, 2); // base
  g.lineStyle(4, 0x4a5160, 1);
  g.lineBetween(x + 50, y - 6, x + 50, y - 64);
  g.lineBetween(x + 50, y - 64, x + 88, y - 64);
  g.lineBetween(x + 84, y - 64, x + 84, y - 48);
  g.fillStyle(0x0066CC, 1);
  g.fillRoundedRect(x + 72, y - 48, 24, 20, 3); // hanging code block
  scene.add
    .text(x + 84, y - 38, '</>', { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold' })
    .setOrigin(0.5)
    .setDepth(y + 1);
  colliders.push({ kind: 'circle', x: x + 50, y, r: 20 });
  // Cones.
  for (const cxp of [x - 4, x + 18]) {
    g.fillStyle(0xf26a2e, 1);
    g.fillTriangle(cxp - 6, y + 6, cxp + 6, y + 6, cxp, y - 12);
    g.fillStyle(0xf4f4f4, 1);
    g.fillRect(cxp - 4, y - 2, 8, 3);
  }
  signpost(scene, x, y - 84, '🛠️  Build');
  return colliders;
}
