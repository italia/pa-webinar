import * as Phaser from 'phaser';

import { DEPTH } from '../constants';
import { DEFAULT_GATE_LABELS, type GateLabels } from '../public-types';
import type { Collider, Luogo, WorldLayout } from './WorldMap';

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
  // Il cartello si misura sul testo: la larghezza cambia con la lingua.
  const testo = scene.add
    .text(x, y, label, { fontFamily: LABEL_FONT, fontSize: '19px', fontStyle: '600', color: '#ffffff' })
    .setOrigin(0.5)
    .setDepth(depth + 1);
  const padW = testo.width + 28;
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(BLUE, 1);
  g.fillRoundedRect(x - padW / 2, y - 17, padW, 34, 10);
  g.lineStyle(1.5, INK, 0.25);
  g.strokeRoundedRect(x - padW / 2, y - 17, padW, 34, 10);
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

/** Un albero piatto: chioma tonda in due verdi, tronco corto. */
function albero(g: Phaser.GameObjects.Graphics, x: number, y: number, r = 26): Collider {
  softShadow(g, x, y, r * 0.8, 0.12);
  g.fillStyle(0x7a5a3a, 1);
  g.fillRoundedRect(x - 4, y - 18, 8, 20, 3);
  g.fillStyle(GREEN, 0.9);
  g.fillCircle(x, y - 30, r);
  g.fillStyle(0x37a06b, 0.9);
  g.fillCircle(x - r * 0.35, y - 36, r * 0.55);
  g.fillStyle(WHITE, 0.18);
  g.fillCircle(x - r * 0.45, y - 42, r * 0.22);
  return { kind: 'circle', x, y: y - 4, r: 12 };
}

/** Un'aiuola: un'isola verde con i fiori nei colori del design system. */
function aiuola(g: Phaser.GameObjects.Graphics, x: number, y: number, larga: number, alta: number, seme: number): Collider {
  softShadow(g, x, y + alta / 2 - 6, larga / 2, 0.08);
  g.fillStyle(WHITE, 1);
  g.fillRoundedRect(x - larga / 2 - 4, y - alta / 2 - 4, larga + 8, alta + 8, alta / 2 + 4);
  g.fillStyle(0x8ccf9f, 1);
  g.fillRoundedRect(x - larga / 2, y - alta / 2, larga, alta, alta / 2);
  const colori = [BLUE, RED, 0xf7a11a, WHITE, 0x7b5aae];
  let s = seme;
  for (let i = 0; i < Math.round(larga / 14); i++) {
    s = (s * 9301 + 49297) % 233280;
    const fx = x - larga / 2 + 10 + ((s / 233280) * (larga - 20));
    s = (s * 9301 + 49297) % 233280;
    const fy = y - alta / 2 + 8 + ((s / 233280) * (alta - 16));
    g.fillStyle(colori[i % colori.length] ?? WHITE, 1);
    g.fillCircle(fx, fy, 3.4);
  }
  return { kind: 'rect', rect: new Phaser.Geom.Rectangle(x - larga / 2, y - alta / 2, larga, alta) };
}

/** Un lampione: palo blu notte e luce bianca. */
function lampione(g: Phaser.GameObjects.Graphics, x: number, y: number): Collider {
  softShadow(g, x, y, 10, 0.1);
  g.fillStyle(INK, 1);
  g.fillRoundedRect(x - 3, y - 70, 6, 72, 3);
  g.fillRoundedRect(x - 9, y - 2, 18, 5, 2);
  g.fillStyle(WHITE, 1);
  g.fillCircle(x, y - 76, 10);
  g.lineStyle(2, INK, 1);
  g.strokeCircle(x, y - 76, 10);
  g.fillStyle(0xffe9a8, 0.9);
  g.fillCircle(x, y - 76, 5);
  return { kind: 'circle', x, y, r: 7 };
}

export function buildPiazzaMap(
  scene: Phaser.Scene,
  world: { w: number; h: number },
  labels: GateLabels = DEFAULT_GATE_LABELS,
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

  // ── STEP 3 — I vialetti: dalla fontana al cancello e ai quattro spazi,
  // un po' più chiari del pavimento, bordati di puntini ──
  const vialetti = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 1);
  const fontanaY = Math.round(h * 0.62);
  const vialetto = (x1: number, y1: number, x2: number, y2: number): void => {
    vialetti.lineStyle(64, 0xeef5fc, 1);
    vialetti.lineBetween(x1, y1, x2, y2);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    vialetti.fillStyle(GRID, 0.9);
    for (let d = 0; d < len; d += 22) {
      const px = x1 + ((x2 - x1) * d) / len;
      const py = y1 + ((y2 - y1) * d) / len;
      vialetti.fillCircle(px + nx * 34, py + ny * 34, 1.8);
      vialetti.fillCircle(px - nx * 34, py - ny * 34, 1.8);
    }
  };
  vialetto(gateCx, dividerY + 40, gateCx, fontanaY);
  for (const [zx, zy] of [
    [w * 0.18, h * 0.55],
    [w * 0.82, h * 0.55],
    [w * 0.18, h * 0.84],
    [w * 0.82, h * 0.84],
  ] as const) {
    vialetto(gateCx, fontanaY, zx, zy + 70);
  }
  // Il largo attorno alla fontana.
  vialetti.fillStyle(0xeef5fc, 1);
  vialetti.fillEllipse(gateCx, fontanaY + 6, 560, 400);
  vialetti.lineStyle(2, GRID, 0.8);
  vialetti.strokeEllipse(gateCx, fontanaY + 6, 560, 400);

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
  signPill(scene, gateCx, dividerY - pillarH - 32, labels.gateSign, dividerY + 4);

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

  // ── STEP 7 — I quattro spazi, ognuno con la sua sagoma e il suo colore
  // della tavolozza .italia: il chiosco del caffè (verde), l'edicola della
  // bacheca (blu), la facciata della galleria (rosso), la bottega del
  // laboratorio (blu notte). Il cartello sopra dice il nome ──
  const NAVY = INK;
  const spazio = (
    x: number,
    y: number,
    larghezza: number,
    altezza: number,
    title: string,
    cartelloY: number,
    disegna: (g: Phaser.GameObjects.Graphics) => void,
  ): void => {
    const g = scene.add.graphics().setDepth(y);
    softShadow(g, x, y + altezza / 2 - 4, larghezza / 2 + 10, 0.14);
    disegna(g);
    signPill(scene, x, cartelloY, title, y + 2);
    staticColliders.push({
      kind: 'rect',
      rect: new Phaser.Geom.Rectangle(x - larghezza / 2, y - altezza / 2, larghezza, altezza),
    });
  };

  // Il caffè: un chiosco tondo con la tenda a righe verdi e bianche.
  {
    const x = w * 0.18;
    const y = h * 0.55;
    spazio(x, y, 180, 96, labels.zoneCafe, y - 92, (g) => {
      g.fillStyle(WHITE, 1); // il corpo
      g.fillRoundedRect(x - 82, y - 30, 164, 78, 34);
      g.lineStyle(1.5, CARD_BD, 1);
      g.strokeRoundedRect(x - 82, y - 30, 164, 78, 34);
      g.fillStyle(NAVY, 1); // il bancone con le tazzine
      g.fillRoundedRect(x - 56, y - 4, 112, 26, 8);
      for (const cx of [x - 30, x, x + 30]) {
        g.fillStyle(WHITE, 1);
        g.fillRoundedRect(cx - 7, y + 2, 14, 11, 3);
        g.lineStyle(2, WHITE, 1);
        g.strokeCircle(cx + 9, y + 7, 3);
      }
      // La tenda: una cupola a spicchi verdi e bianchi, smerlata.
      const top = y - 62;
      for (let k = 0; k < 8; k++) {
        const x0 = x - 96 + k * 24;
        g.fillStyle(k % 2 === 0 ? GREEN : WHITE, 1);
        g.fillRect(x0, top + 10, 24, 30);
      }
      g.fillStyle(GREEN, 1);
      g.fillEllipse(x, top + 10, 192, 30);
      g.fillStyle(0x37a06b, 1);
      g.fillEllipse(x, top + 6, 150, 18);
      for (let k = 0; k < 8; k++) {
        g.fillStyle(k % 2 === 0 ? GREEN : WHITE, 1);
        g.fillCircle(x - 84 + k * 24, top + 40, 12);
      }
      g.lineStyle(1.5, 0x006b46, 0.6);
      g.strokeEllipse(x, top + 10, 192, 30);
      // In cima, l'insegna con la tazzina.
      g.fillStyle(WHITE, 1);
      g.fillCircle(x, top - 14, 15);
      g.lineStyle(2, GREEN, 1);
      g.strokeCircle(x, top - 14, 15);
      g.fillStyle(GREEN, 1);
      g.fillRoundedRect(x - 8, top - 19, 13, 10, 3);
      g.lineStyle(2, GREEN, 1);
      g.strokeCircle(x + 7, top - 14, 3);
    });
  }

  // La bacheca: un'edicola con il tetto blu e le riviste in vetrina.
  {
    const x = w * 0.82;
    const y = h * 0.55;
    spazio(x, y, 170, 100, labels.zoneBoard, y - 104, (g) => {
      g.fillStyle(WHITE, 1); // il corpo
      g.fillRoundedRect(x - 78, y - 40, 156, 88, 8);
      g.lineStyle(1.5, CARD_BD, 1);
      g.strokeRoundedRect(x - 78, y - 40, 156, 88, 8);
      // La vetrina: riviste e fogli nei colori del design system.
      g.fillStyle(0xeef5fc, 1);
      g.fillRoundedRect(x - 66, y - 30, 132, 50, 6);
      const riviste = [BLUE, RED, GREEN, 0xf7a11a, 0x7b5aae, CYAN];
      riviste.forEach((c, k) => {
        const rx = x - 60 + (k % 3) * 42;
        const ry = y - 26 + Math.floor(k / 3) * 23;
        g.fillStyle(c, 0.9);
        g.fillRoundedRect(rx, ry, 36, 19, 2);
        g.fillStyle(WHITE, 0.85);
        g.fillRect(rx + 5, ry + 5, 18, 3);
        g.fillRect(rx + 5, ry + 11, 12, 2);
      });
      g.fillStyle(NAVY, 1); // il banco
      g.fillRoundedRect(x - 70, y + 24, 140, 14, 4);
      // Il tetto a padiglione, blu, che sporge.
      g.fillStyle(BLUE, 1);
      g.fillTriangle(x - 96, y - 40, x + 96, y - 40, x, y - 82);
      g.fillStyle(0x004d99, 1);
      g.fillRect(x - 96, y - 44, 192, 8);
      // L'insegna «i» delle informazioni.
      g.fillStyle(WHITE, 1);
      g.fillCircle(x, y - 60, 11);
      g.fillStyle(BLUE, 1);
      g.fillRoundedRect(x - 2, y - 61, 4, 9, 1.5);
      g.fillCircle(x, y - 65, 2);
    });
  }

  // La galleria: una facciata con colonne e frontone, una fascia rossa.
  {
    const x = w * 0.18;
    const y = h * 0.84;
    spazio(x, y, 190, 96, labels.zoneGallery, y - 112, (g) => {
      g.fillStyle(0xdfe8f1, 1); // i gradini
      g.fillRoundedRect(x - 98, y + 36, 196, 12, 4);
      g.fillStyle(0xeaf1f8, 1);
      g.fillRoundedRect(x - 90, y + 28, 180, 10, 4);
      g.fillStyle(WHITE, 1); // il muro dietro le colonne
      g.fillRect(x - 84, y - 34, 168, 64);
      // I quadri fra le colonne.
      [BLUE, RED, GREEN].forEach((c, k) => {
        const qx = x - 60 + k * 40;
        g.fillStyle(0xf2f7fc, 1);
        g.fillRect(qx - 12, y - 20, 24, 28);
        g.lineStyle(2, 0xb59a5a, 1);
        g.strokeRect(qx - 12, y - 20, 24, 28);
        g.fillStyle(c, 0.85);
        g.fillCircle(qx, y - 6, 6);
      });
      // Le colonne.
      for (const cx of [x - 80, x - 40, x, x + 40, x + 80]) {
        if (cx === x) continue;
        g.fillStyle(WHITE, 1);
        g.fillRect(cx - 7, y - 38, 14, 68);
        g.lineStyle(1.5, CARD_BD, 1);
        g.strokeRect(cx - 7, y - 38, 14, 68);
        g.fillStyle(0xdfe8f1, 1);
        g.fillRect(cx - 9, y - 42, 18, 6);
      }
      // L'architrave rosso e il frontone.
      g.fillStyle(RED, 1);
      g.fillRect(x - 96, y - 52, 192, 12);
      g.fillStyle(WHITE, 1);
      g.fillTriangle(x - 96, y - 52, x + 96, y - 52, x, y - 88);
      g.lineStyle(2, RED, 1);
      g.strokeTriangle(x - 96, y - 52, x + 96, y - 52, x, y - 88);
      g.fillStyle(RED, 0.85);
      g.fillCircle(x, y - 64, 6);
    });
  }

  // Il laboratorio: una bottega blu notte con il tetto a denti di sega e la
  // saracinesca chiara.
  {
    const x = w * 0.82;
    const y = h * 0.84;
    spazio(x, y, 180, 96, labels.zoneLab, y - 108, (g) => {
      g.fillStyle(NAVY, 1); // il corpo
      g.fillRoundedRect(x - 86, y - 38, 172, 86, 6);
      // Il tetto a denti di sega, con le vetrate azzurre.
      for (let k = 0; k < 4; k++) {
        const x0 = x - 86 + k * 43;
        g.fillStyle(NAVY, 1);
        g.fillTriangle(x0, y - 38, x0 + 43, y - 38, x0 + 43, y - 72);
        g.fillStyle(CYAN, 0.75);
        g.fillTriangle(x0 + 30, y - 40, x0 + 41, y - 40, x0 + 41, y - 62);
      }
      // La saracinesca.
      g.fillStyle(0xdfe8f1, 1);
      g.fillRoundedRect(x - 60, y - 22, 80, 70, 4);
      g.fillStyle(0xc3d4e6, 1);
      for (let ly = y - 16; ly < y + 46; ly += 8) g.fillRect(x - 58, ly, 76, 2);
      // La finestra con lo schermo e l'ingranaggio giallo.
      g.fillStyle(CYAN, 0.85);
      g.fillRoundedRect(x + 30, y - 20, 42, 30, 4);
      g.fillStyle(WHITE, 0.9);
      for (const ry of [-14, -8, -2]) g.fillRect(x + 36, y + ry, 22, 2);
      g.fillStyle(0xf7a11a, 1);
      g.fillCircle(x + 51, y + 30, 11);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        g.fillCircle(x + 51 + Math.cos(ang) * 11, y + 30 + Math.sin(ang) * 11, 3.4);
      }
      g.fillStyle(NAVY, 1);
      g.fillCircle(x + 51, y + 30, 4.5);
    });
  }

  // ── STEP 7b — Gli oggetti dei quattro spazi ──
  const oggetto = (y: number) => scene.add.graphics().setDepth(y);
  {
    // Caffè: la lavagnetta con il menù.
    const x = w * 0.18 + 140;
    const y = h * 0.55 + 40;
    const g = oggetto(y);
    softShadow(g, x, y, 22, 0.1);
    g.fillStyle(INK, 1);
    g.fillTriangle(x - 20, y, x + 20, y, x, y - 54);
    g.fillStyle(WHITE, 1);
    g.fillRoundedRect(x - 15, y - 44, 30, 36, 4);
    g.fillStyle(BLUE, 0.7);
    for (const ry of [-36, -28, -20]) g.fillRoundedRect(x - 10, y + ry, 20, 3, 1.5);
    staticColliders.push({ kind: 'circle', x, y: y - 6, r: 14 });
  }
  {
    // Bacheca: il pannello con i fogli appuntati.
    const x = w * 0.82 - 168;
    const y = h * 0.55 + 46;
    const g = oggetto(y);
    softShadow(g, x, y, 44, 0.1);
    g.fillStyle(INK, 1);
    g.fillRect(x - 38, y - 70, 5, 72);
    g.fillRect(x + 33, y - 70, 5, 72);
    g.fillStyle(WHITE, 1);
    g.fillRoundedRect(x - 44, y - 76, 88, 52, 6);
    g.lineStyle(2, INK, 1);
    g.strokeRoundedRect(x - 44, y - 76, 88, 52, 6);
    const fogli: [number, number, number][] = [
      [-32, -68, BLUE],
      [-6, -66, GREEN],
      [18, -69, 0xf7a11a],
      [-20, -48, RED],
      [8, -47, CYAN],
    ];
    for (const [fx, fy, c] of fogli) {
      g.fillStyle(c, 0.85);
      g.fillRoundedRect(x + fx, y + fy, 20, 16, 2);
      g.fillStyle(WHITE, 1);
      g.fillCircle(x + fx + 10, y + fy + 2, 2);
    }
    staticColliders.push({ kind: 'rect', rect: new Phaser.Geom.Rectangle(x - 44, y - 6, 88, 10) });
  }
  {
    // Galleria: due cavalletti con i quadri.
    const base = { x: w * 0.18 + 130, y: h * 0.84 + 44 };
    [
      [0, 0, BLUE],
      [56, 14, RED],
    ].forEach(([dx, dy, c]) => {
      const x = base.x + (dx ?? 0);
      const y = base.y + (dy ?? 0);
      const g = oggetto(y);
      softShadow(g, x, y, 18, 0.1);
      g.lineStyle(4, 0x7a5a3a, 1);
      g.lineBetween(x - 14, y, x, y - 58);
      g.lineBetween(x + 14, y, x, y - 58);
      g.lineBetween(x, y - 4, x, y - 50);
      g.fillStyle(WHITE, 1);
      g.fillRoundedRect(x - 20, y - 58, 40, 32, 3);
      g.lineStyle(2, CARD_BD, 1);
      g.strokeRoundedRect(x - 20, y - 58, 40, 32, 3);
      g.fillStyle(c ?? BLUE, 0.85);
      g.fillCircle(x - 4, y - 44, 7);
      g.fillStyle(GREEN, 0.75);
      g.fillTriangle(x - 16, y - 30, x + 2, y - 30, x - 6, y - 42);
      g.fillTriangle(x - 2, y - 30, x + 16, y - 30, x + 8, y - 46);
      staticColliders.push({ kind: 'circle', x, y: y - 4, r: 12 });
    });
  }
  {
    // Laboratorio: il banco da lavoro con il portatile.
    const x = w * 0.82 - 168;
    const y = h * 0.84 + 44;
    const g = oggetto(y);
    softShadow(g, x, y, 46, 0.1);
    g.fillStyle(INK, 1);
    g.fillRect(x - 40, y - 26, 6, 28);
    g.fillRect(x + 34, y - 26, 6, 28);
    g.fillStyle(0x5a768a, 1);
    g.fillRoundedRect(x - 46, y - 34, 92, 12, 4);
    g.fillStyle(WHITE, 1); // il portatile
    g.fillRoundedRect(x - 18, y - 40, 36, 7, 2);
    g.fillStyle(INK, 1);
    g.fillRoundedRect(x - 15, y - 64, 30, 24, 3);
    g.fillStyle(CYAN, 0.9);
    g.fillRoundedRect(x - 12, y - 61, 24, 18, 2);
    g.fillStyle(WHITE, 0.9);
    for (const ry of [-57, -52, -47]) g.fillRect(x - 9, y + ry, 12, 2);
    g.fillStyle(0xf7a11a, 1); // un ingranaggio, in piccolo
    g.fillCircle(x + 32, y - 40, 7);
    g.fillStyle(0x5a768a, 1);
    g.fillCircle(x + 32, y - 40, 3);
    staticColliders.push({ kind: 'rect', rect: new Phaser.Geom.Rectangle(x - 46, y - 30, 92, 14) });
  }

  // ── STEP 8 — La fontana al centro: una vasca a quattro lobi con il bordo
  // di pietra bianca (e lo spessore visibile davanti), l'acqua che si
  // increspa, una coppa su colonna da cui l'acqua ricade in quattro getti, e
  // quattro zampilli piccoli sui lobi ──
  const wellY = Math.round(h * 0.62);
  const fontana = scene.add.graphics().setDepth(wellY);
  // I quattro lobi (schiacciati in altezza: la piazza si vede di tre quarti).
  const LX = 92;
  const LY = 58;
  const lobi: [number, number][] = [
    [-LX, 0],
    [LX, 0],
    [0, -LY],
    [0, LY],
  ];
  const quadrifoglio = (g: Phaser.GameObjects.Graphics, dy: number, rx: number, ry: number, inset: number): void => {
    for (const [lx, ly] of lobi) g.fillEllipse(gateCx + lx, wellY + ly + dy, (rx - inset) * 2, (ry - inset) * 2);
    g.fillRoundedRect(gateCx - LX, wellY - LY + dy + inset * 0.6, LX * 2, LY * 2 - inset * 1.2, 12);
  };
  fontana.fillStyle(SHADOW, 0.06);
  fontana.fillEllipse(gateCx, wellY + LY + 18, 300, 60);
  fontana.fillStyle(0xc3d4e6, 1); // lo spessore del bordo, davanti
  quadrifoglio(fontana, 12, 74, 56, 0);
  fontana.fillStyle(WHITE, 1); // il bordo di pietra
  quadrifoglio(fontana, 0, 74, 56, 0);
  fontana.lineStyle(2, CARD_BD, 1);
  for (const [lx, ly] of lobi) fontana.strokeEllipse(gateCx + lx, wellY + ly, 148, 112);
  fontana.fillStyle(WHITE, 1); // ricopre i tratti interni dei contorni
  quadrifoglio(fontana, 0, 74, 56, 4);
  // L'acqua: colori pieni, non trasparenti (le forme si sovrappongono e
  // l'alfa farebbe macchie più scure dove si incrociano).
  fontana.fillStyle(0x8fcdef, 1);
  quadrifoglio(fontana, 0, 74, 56, 12);
  fontana.fillStyle(0x62b6e6, 1);
  quadrifoglio(fontana, 5, 74, 56, 22);
  // La colonna e la coppa al centro.
  fontana.fillStyle(0x17324d, 0.12);
  fontana.fillEllipse(gateCx, wellY + 6, 70, 22);
  fontana.fillStyle(WHITE, 1);
  fontana.fillRoundedRect(gateCx - 9, wellY - 46, 18, 50, 6);
  fontana.lineStyle(1.5, CARD_BD, 1);
  fontana.strokeRoundedRect(gateCx - 9, wellY - 46, 18, 50, 6);
  fontana.fillStyle(0xc3d4e6, 1);
  fontana.fillEllipse(gateCx, wellY - 42, 66, 22);
  fontana.fillStyle(WHITE, 1);
  fontana.fillEllipse(gateCx, wellY - 48, 66, 22);
  fontana.fillStyle(0x7fc4ea, 1);
  fontana.fillEllipse(gateCx, wellY - 49, 52, 14);
  fontana.fillStyle(WHITE, 1); // la punta
  fontana.fillRoundedRect(gateCx - 4, wellY - 66, 8, 16, 4);
  fontana.fillCircle(gateCx, wellY - 68, 5);
  // Le increspature nell'acqua, attorno alla colonna e nei lobi.
  for (let i = 0; i < 4; i++) {
    const [lx, ly] = lobi[i] ?? [0, 0];
    const anello = scene.add
      .ellipse(gateCx + lx * 0.72, wellY + ly * 0.72, 18, 10)
      .setStrokeStyle(2, WHITE, 0.85)
      .setDepth(wellY + 1);
    scene.tweens.add({
      targets: anello,
      scaleX: 3,
      scaleY: 3,
      alpha: { from: 0.9, to: 0 },
      duration: 2200,
      delay: i * 550,
      repeat: -1,
    });
  }
  // L'acqua che ricade dalla coppa in quattro getti, e gli zampilli sui lobi.
  const getto = (x0: number, y0: number, x1: number, y1: number, alto: number, ritardo: number, depth: number): void => {
    const goccia = scene.add.circle(x0, y0, 2.6, WHITE, 0.95).setDepth(depth);
    const t = { p: 0 };
    scene.tweens.add({
      targets: t,
      p: 1,
      duration: 900,
      delay: ritardo,
      repeat: -1,
      onUpdate: () => {
        const p = t.p;
        goccia.setPosition(x0 + (x1 - x0) * p, y0 + (y1 - y0) * p - Math.sin(p * Math.PI) * alto);
        goccia.setAlpha(1 - p * 0.6);
      },
    });
  };
  for (let i = 0; i < 4; i++) {
    const [lx, ly] = lobi[i] ?? [0, 0];
    for (let k = 0; k < 3; k++) {
      getto(gateCx, wellY - 70, gateCx + lx * 0.45, wellY + ly * 0.45 - 6, 26, k * 300 + i * 75, wellY + 3);
      getto(gateCx + lx * 0.78, wellY + ly * 0.78, gateCx + lx * 0.78 + (k - 1) * 8, wellY + ly * 0.78, 22, k * 300 + i * 120, wellY + 2);
    }
  }
  // Ci si gira intorno: un cerchio per lobo e uno al centro.
  for (const [lx, ly] of lobi) staticColliders.push({ kind: 'circle', x: gateCx + lx, y: wellY + ly, r: 64 });
  staticColliders.push({ kind: 'circle', x: gateCx, y: wellY, r: 80 });

  // ── STEP 9a — Alberi, aiuole e lampioni ──
  for (const [x, y, r] of [
    [70, 590, 28],
    [170, 690, 22],
    [60, 980, 26],
    [80, 1430, 28],
    [210, 1540, 22],
    [w - 70, 590, 28],
    [w - 170, 690, 22],
    [w - 60, 980, 26],
    [w - 80, 1430, 28],
    [w - 210, 1540, 22],
    [430, 580, 24],
    [w - 430, 580, 24],
    [640, 1565, 24],
    [w - 640, 1565, 24],
    [950, 1560, 20],
    [w - 950, 1560, 20],
  ] as const) {
    staticColliders.push(albero(scene.add.graphics().setDepth(y), x, y, r));
  }
  for (const [x, y, lw, lh, seme] of [
    [gateCx - 330, 760, 150, 44, 3],
    [gateCx + 330, 760, 150, 44, 7],
    [gateCx, 1265, 170, 44, 11],
    [700, 640, 120, 40, 5],
    [w - 700, 640, 120, 40, 13],
  ] as const) {
    staticColliders.push(aiuola(scene.add.graphics().setDepth(y), x, y, lw, lh, seme));
  }
  for (const [x, y] of [
    [gateCx - 70, 640],
    [gateCx + 70, 640],
    [gateCx - 240, 850],
    [gateCx + 240, 850],
    [gateCx - 290, 1150],
    [gateCx + 290, 1150],
  ] as const) {
    staticColliders.push(lampione(scene.add.graphics().setDepth(y), x, y));
  }

  // ── STEP 9 — Benches + planters (soft walk-around obstacles) ──
  const props = scene.add.graphics().setDepth(DEPTH.GROUND_DETAIL + 3);
  staticColliders.push(bench(props, gateCx - 150, wellY + 168));
  staticColliders.push(bench(props, gateCx + 150, wellY + 168));
  for (const t of [
    { x: w * 0.05, y: h * 0.74 },
    { x: w * 0.95, y: h * 0.74 },
    { x: gateCx, y: h * 0.97 },
  ]) {
    const g = scene.add.graphics().setDepth(t.y);
    staticColliders.push(planter(g, t.x, t.y, 24));
  }

  // ── STEP 10 — I tavolini del caffè: tondi, bianchi, con le sedie blu ──
  const caffe = { x: w * 0.18, y: h * 0.55 };
  for (const dx of [-62, 62]) {
    const tx = caffe.x + dx;
    const ty = caffe.y + 96;
    const g = scene.add.graphics().setDepth(ty);
    softShadow(g, tx, ty, 22, 0.1);
    for (const sx of [-22, 22]) {
      g.fillStyle(BLUE, 0.85);
      g.fillRoundedRect(tx + sx - 7, ty - 9, 14, 14, 4);
    }
    g.fillStyle(WHITE, 1);
    g.fillCircle(tx, ty - 6, 15);
    g.lineStyle(1.5, CARD_BD, 1);
    g.strokeCircle(tx, ty - 6, 15);
    g.fillStyle(PAVING_ALT, 1); // la tazzina
    g.fillCircle(tx, ty - 7, 4);
    staticColliders.push({ kind: 'circle', x: tx, y: ty - 4, r: 16 });
  }

  // ── STEP 11 — Il pozzo dei desideri, in un angolo tranquillo ──
  const pozzo = { x: gateCx - 430, y: Math.round(h * 0.88) };
  {
    const g = scene.add.graphics().setDepth(pozzo.y);
    softShadow(g, pozzo.x, pozzo.y, 34, 0.12);
    g.fillStyle(WHITE, 1); // la vera del pozzo
    g.fillRoundedRect(pozzo.x - 30, pozzo.y - 26, 60, 30, 10);
    g.lineStyle(1.5, CARD_BD, 1);
    g.strokeRoundedRect(pozzo.x - 30, pozzo.y - 26, 60, 30, 10);
    g.fillStyle(INK, 0.85); // il buio dentro
    g.fillEllipse(pozzo.x, pozzo.y - 24, 44, 10);
    g.fillStyle(CYAN, 0.7);
    g.fillEllipse(pozzo.x, pozzo.y - 23, 30, 5);
    g.fillStyle(BLUE, 1); // i pali e il tettuccio
    g.fillRect(pozzo.x - 28, pozzo.y - 66, 5, 42);
    g.fillRect(pozzo.x + 23, pozzo.y - 66, 5, 42);
    g.fillStyle(INK, 1);
    g.fillTriangle(pozzo.x - 40, pozzo.y - 62, pozzo.x + 40, pozzo.y - 62, pozzo.x, pozzo.y - 84);
    g.fillStyle(BLUE, 1);
    g.fillTriangle(pozzo.x - 34, pozzo.y - 64, pozzo.x + 34, pozzo.y - 64, pozzo.x, pozzo.y - 80);
    staticColliders.push({ kind: 'rect', rect: new Phaser.Geom.Rectangle(pozzo.x - 30, pozzo.y - 26, 60, 30) });
  }

  // I luoghi dove succede qualcosa: davanti a ogni spazio, la fontana, il
  // pozzo.
  // Il segnale sta sull'angolo della tenda di ogni padiglione, sullo
  // zampillo della fontana (dove nessuno può stare) e sopra il tettuccio del
  // pozzo.
  const angolo = (zx: number, zy: number) => ({ x: zx + 104, y: zy - 58 });
  const luoghi: Luogo[] = [
    { id: 'caffe', x: caffe.x, y: caffe.y + 70, raggio: 120, segno: angolo(caffe.x, caffe.y) },
    { id: 'bacheca', x: w * 0.82, y: h * 0.55 + 70, raggio: 120, segno: angolo(w * 0.82, h * 0.55) },
    { id: 'galleria', x: w * 0.18, y: h * 0.84 + 70, raggio: 120, segno: angolo(w * 0.18, h * 0.84) },
    { id: 'laboratorio', x: w * 0.82, y: h * 0.84 + 70, raggio: 120, segno: angolo(w * 0.82, h * 0.84) },
    { id: 'fontana', x: gateCx, y: wellY, raggio: 210, segno: { x: gateCx, y: wellY - 96 } },
    { id: 'pozzo', x: pozzo.x, y: pozzo.y + 10, raggio: 90, segno: { x: pozzo.x, y: pozzo.y - 92 } },
  ];

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
    luoghi,
  };
}
