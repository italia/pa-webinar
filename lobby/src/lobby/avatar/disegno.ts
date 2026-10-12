/**
 * Il personaggio della piazza, disegnato in vettoriale piatto nello stile del
 * design system: forme morbide, colori pieni, un contorno blu notte leggero.
 * Tre direzioni (di fronte, di spalle, di profilo verso sinistra: la destra è
 * la stessa specchiata) per tre passi (fermo, passo sinistro, passo destro).
 *
 * Funzione pura sul Canvas 2D, senza Phaser: la usano la scena (che ne fa una
 * texture) e l'editor del personaggio nella pagina (l'anteprima).
 *
 * Il disegno sta in un riquadro di AV_W × AV_H con i piedi in basso al centro.
 */

import {
  CAPELLI,
  CAPPELLI,
  COLORI_CAPELLI,
  COLORI_SCARPE,
  COLORI_SOTTO,
  COLORI_VESTITI,
  MAGLIE,
  OCCHIALI,
  PELLI,
  SOTTO,
  type AvatarLook,
} from './look';

export const AV_W = 48;
export const AV_H = 64;
/** Le direzioni disegnate; la destra è la sinistra specchiata. */
export const DIREZIONI = ['down', 'up', 'left'] as const;
export type DirezioneDisegnata = (typeof DIREZIONI)[number];
/** Fermo, passo sinistro, passo destro. */
export const PASSI = 3;

const INCHIOSTRO = '#17324d';
const BIANCO = '#ffffff';
const SCURO = '#2b3440';

type Ctx = CanvasRenderingContext2D;

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, colore: string): void {
  ctx.fillStyle = colore;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}

function cerchio(ctx: Ctx, x: number, y: number, r: number, colore: string): void {
  ctx.fillStyle = colore;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function ellisse(ctx: Ctx, x: number, y: number, rx: number, ry: number, colore: string): void {
  ctx.fillStyle = colore;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Il contorno leggero che unisce le forme (blu notte, trasparente). */
function contorno(ctx: Ctx, disegna: () => void): void {
  ctx.save();
  ctx.strokeStyle = INCHIOSTRO;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  disegna();
  ctx.stroke();
  ctx.restore();
}

interface Tinte {
  pelle: string;
  pelleOmbra: string;
  occhi: string;
  bocca: string;
  capelli: string;
  capelliOmbra: string;
  sopra: string;
  sopraOmbra: string;
  sotto: string;
  sottoOmbra: string;
  scarpe: string;
  cappello: string;
  cappelloOmbra: string;
}

function tinte(look: AvatarLook): Tinte {
  const pelle = PELLI[look.pelle] ?? PELLI[1]!;
  const capelli = COLORI_CAPELLI[look.coloreCapelli] ?? COLORI_CAPELLI[0]!;
  const sopra = COLORI_VESTITI[look.coloreMaglia] ?? COLORI_VESTITI[0]!;
  const sotto = COLORI_SOTTO[look.coloreSotto] ?? COLORI_SOTTO[0]!;
  const scarpe = COLORI_SCARPE[look.scarpe] ?? COLORI_SCARPE[0]!;
  const cappello = COLORI_VESTITI[look.coloreCappello] ?? COLORI_VESTITI[0]!;
  return {
    pelle: pelle.colore,
    pelleOmbra: pelle.ombra,
    occhi: pelle.occhi,
    bocca: pelle.bocca,
    capelli: capelli.colore,
    capelliOmbra: capelli.ombra,
    sopra: sopra.colore,
    sopraOmbra: sopra.ombra,
    sotto: sotto.colore,
    sottoOmbra: sotto.ombra,
    scarpe: scarpe.colore,
    cappello: cappello.colore,
    cappelloOmbra: cappello.ombra,
  };
}

/**
 * Disegna il personaggio. `scala` ingrandisce il riquadro AV_W × AV_H; (ox, oy)
 * è l'angolo in alto a sinistra del riquadro sul canvas.
 */
export function disegnaPersonaggio(
  ctx: Ctx,
  look: AvatarLook,
  dir: DirezioneDisegnata,
  passo: number,
  inCall = false,
  scala = 1,
  ox = 0,
  oy = 0,
): void {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scala, scala);
  const t = tinte(look);
  if (dir === 'left') profilo(ctx, look, t, passo, inCall);
  else fronte(ctx, look, t, dir === 'up', passo, inCall);
  ctx.restore();
}

// ── di fronte e di spalle ──────────────────────────────────────────────────

function fronte(ctx: Ctx, look: AvatarLook, t: Tinte, spalle: boolean, passo: number, inCall: boolean): void {
  const cx = AV_W / 2;
  const maglia = MAGLIE[look.maglia] ?? 'maglietta';
  const sotto = SOTTO[look.sotto] ?? 'pantaloni';
  const stile = CAPELLI[look.capelli] ?? 'corti';
  const cappello = CAPPELLI[look.cappello] ?? 'nessuno';
  // Il passo: una gamba si alza, le braccia oscillano.
  const alzaSx = passo === 1 ? 3 : 0;
  const alzaDx = passo === 2 ? 3 : 0;
  const braccio = passo === 1 ? 2 : passo === 2 ? -2 : 0;

  // Capelli dietro la testa (lunghi, caschetto, coda vista di fronte).
  if (!spalle) capelliDietro(ctx, stile, t, cx);

  // Gambe e scarpe.
  const gonna = maglia === 'vestito' || sotto === 'gonna';
  const gambeNude = gonna || sotto === 'pantaloncini';
  for (const [x, alza] of [
    [cx - 8, alzaSx],
    [cx + 1, alzaDx],
  ] as const) {
    rr(ctx, x, 44, 7, 15 - alza, 3, gambeNude ? t.pelle : t.sotto);
    if (sotto === 'pantaloncini' && !gonna) rr(ctx, x, 44, 7, 7, 2, t.sotto);
    rr(ctx, x - 0.5, 55 - alza, 8, 6, 3, t.scarpe);
  }

  // Braccia: maniche e mani.
  const maniche = maglia === 'maglietta' || maglia === 'vestito' ? 7 : 14;
  for (const [x, dy] of [
    [cx - 13, braccio],
    [cx + 7, -braccio],
  ] as const) {
    rr(ctx, x, 30 + dy, 6, 16, 3, t.pelle);
    rr(ctx, x, 30 + dy, 6, maniche, 3, maglia === 'giacca' ? t.sopra : t.sopra);
    cerchio(ctx, x + 3, 46 + dy, 2.6, t.pelle);
  }

  // Busto, e la gonna se c'è.
  if (gonna) {
    const colore = maglia === 'vestito' ? t.sopra : t.sotto;
    ctx.fillStyle = colore;
    ctx.beginPath();
    ctx.moveTo(cx - 10, 42);
    ctx.lineTo(cx + 10, 42);
    ctx.lineTo(cx + 14, 54);
    ctx.quadraticCurveTo(cx, 57, cx - 14, 54);
    ctx.closePath();
    ctx.fill();
  }
  rr(ctx, cx - 11, 28, 22, 20, 6, t.sopra);
  contorno(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(cx - 11, 28, 22, 20, 6);
  });
  dettagliMaglia(ctx, maglia, t, cx, spalle);
  if (sotto !== 'gonna' && maglia !== 'vestito') {
    // La cintura: separa sopra e sotto.
    rr(ctx, cx - 11, 44, 22, 4, 2, t.sotto);
  }

  // Collo e testa.
  rr(ctx, cx - 3, 24, 6, 6, 2, t.pelle);
  cerchio(ctx, cx, 17, 11, t.pelle);
  contorno(ctx, () => {
    ctx.beginPath();
    ctx.arc(cx, 17, 11, 0, Math.PI * 2);
  });

  if (spalle) {
    capelliSpalle(ctx, stile, t, cx, cappello !== 'nessuno');
  } else {
    // La faccia.
    cerchio(ctx, cx - 4, 18, 1.7, t.occhi);
    cerchio(ctx, cx + 4, 18, 1.7, t.occhi);
    ctx.save();
    ctx.strokeStyle = t.bocca;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, 20.5, 3, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
    ctx.restore();
    capelliDavanti(ctx, stile, t, cx, cappello !== 'nessuno');
    occhiali(ctx, look, cx, inCall);
  }
  cappelloFronte(ctx, cappello, t, cx, spalle);
}

function dettagliMaglia(ctx: Ctx, maglia: string, t: Tinte, cx: number, spalle: boolean): void {
  if (maglia === 'felpa') {
    // Il cappuccio attorno al collo; davanti, i lacci.
    rr(ctx, cx - 8, 26, 16, 6, 3, t.sopraOmbra);
    if (!spalle) {
      rr(ctx, cx - 4, 31, 1.6, 7, 1, BIANCO);
      rr(ctx, cx + 2.4, 31, 1.6, 7, 1, BIANCO);
      rr(ctx, cx - 7, 38, 14, 6, 3, t.sopraOmbra);
    }
  } else if (maglia === 'camicia') {
    if (!spalle) {
      ctx.fillStyle = BIANCO;
      ctx.beginPath();
      ctx.moveTo(cx - 5, 28);
      ctx.lineTo(cx, 33);
      ctx.lineTo(cx - 1, 28);
      ctx.closePath();
      ctx.moveTo(cx + 5, 28);
      ctx.lineTo(cx, 33);
      ctx.lineTo(cx + 1, 28);
      ctx.closePath();
      ctx.fill();
      for (const y of [36, 40]) cerchio(ctx, cx, y, 0.9, t.sopraOmbra);
    } else {
      rr(ctx, cx - 6, 27, 12, 3, 1.5, BIANCO);
    }
  } else if (maglia === 'giacca') {
    if (!spalle) {
      rr(ctx, cx - 4, 28, 8, 18, 2, BIANCO);
      ctx.fillStyle = t.sopraOmbra;
      ctx.beginPath();
      ctx.moveTo(cx - 4, 28);
      ctx.lineTo(cx - 1, 36);
      ctx.lineTo(cx - 6, 32);
      ctx.closePath();
      ctx.moveTo(cx + 4, 28);
      ctx.lineTo(cx + 1, 36);
      ctx.lineTo(cx + 6, 32);
      ctx.closePath();
      ctx.fill();
    } else {
      rr(ctx, cx - 1, 34, 2, 12, 1, t.sopraOmbra);
    }
  } else if (maglia === 'maglietta' && !spalle) {
    // Lo scollo.
    ctx.fillStyle = t.sopraOmbra;
    ctx.beginPath();
    ctx.arc(cx, 28, 4, 0, Math.PI);
    ctx.fill();
  } else if (maglia === 'vestito' && !spalle) {
    rr(ctx, cx - 11, 40, 22, 3, 1.5, t.sopraOmbra);
  }
}

function capelliDietro(ctx: Ctx, stile: string, t: Tinte, cx: number): void {
  if (stile === 'lunghi') rr(ctx, cx - 13, 9, 26, 28, 11, t.capelli);
  else if (stile === 'caschetto') rr(ctx, cx - 13, 7, 26, 20, 9, t.capelli);
  else if (stile === 'coda') ellisse(ctx, cx + 12, 16, 4, 8, t.capelliOmbra);
}

function capelliDavanti(ctx: Ctx, stile: string, t: Tinte, cx: number, sottoCappello: boolean): void {
  switch (stile) {
    case 'calvo':
      ellisse(ctx, cx - 4, 10, 3, 1.5, 'rgba(255,255,255,0.45)');
      return;
    case 'rasati':
      ellisse(ctx, cx, 9.5, 11, 5, t.capelliOmbra);
      return;
    case 'ricci':
      if (!sottoCappello) {
        for (const [x, y, r] of [
          [cx - 9, 11, 5.5],
          [cx - 4, 7, 6],
          [cx + 3, 6.5, 6],
          [cx + 9, 10, 5.5],
          [cx + 11, 15, 4],
          [cx - 11, 15, 4],
        ] as const) {
          cerchio(ctx, x, y, r, t.capelli);
        }
        cerchio(ctx, cx - 2, 8, 2, t.capelliOmbra);
        cerchio(ctx, cx + 6, 10, 1.8, t.capelliOmbra);
        return;
      }
      break;
    case 'chignon':
      if (!sottoCappello) cerchio(ctx, cx, 3.5, 5, t.capelli);
      break;
    case 'caschetto':
      ellisse(ctx, cx, 10, 11.5, 7, t.capelli);
      rr(ctx, cx - 11, 9, 22, 5, 2, t.capelli);
      return;
    default:
      break;
  }
  // Corti, lunghi, coda (e ricci o chignon sotto un cappello): la calotta.
  ellisse(ctx, cx, 10, 11.5, 7, t.capelli);
  rr(ctx, cx - 11, 10, 22, 4, 2, t.capelli);
  if (stile === 'lunghi') {
    rr(ctx, cx - 12, 12, 4, 16, 2, t.capelli);
    rr(ctx, cx + 8, 12, 4, 16, 2, t.capelli);
  }
}

function capelliSpalle(ctx: Ctx, stile: string, t: Tinte, cx: number, sottoCappello: boolean): void {
  switch (stile) {
    case 'calvo':
      ellisse(ctx, cx + 3, 10, 3, 1.5, 'rgba(255,255,255,0.45)');
      return;
    case 'rasati':
      ellisse(ctx, cx, 13, 11, 9, t.capelliOmbra);
      return;
    case 'lunghi':
      rr(ctx, cx - 12, 7, 24, 30, 10, t.capelli);
      return;
    case 'caschetto':
      rr(ctx, cx - 12, 6, 24, 22, 9, t.capelli);
      return;
    case 'ricci':
      if (!sottoCappello) {
        for (const [x, y, r] of [
          [cx - 8, 9, 6],
          [cx, 6.5, 6.5],
          [cx + 8, 9, 6],
          [cx - 9, 17, 5],
          [cx + 9, 17, 5],
          [cx, 15, 8],
        ] as const) {
          cerchio(ctx, x, y, r, t.capelli);
        }
        return;
      }
      break;
    default:
      break;
  }
  ellisse(ctx, cx, 14, 11.5, 10, t.capelli);
  if (stile === 'coda') {
    rr(ctx, cx - 1.5, 18, 3, 3, 1, SCURO);
    rr(ctx, cx - 3, 20, 6, 13, 3, t.capelli);
  }
  if (stile === 'chignon' && !sottoCappello) cerchio(ctx, cx, 4, 5, t.capelli);
}

function occhiali(ctx: Ctx, look: AvatarLook, cx: number, inCall: boolean): void {
  if (inCall) {
    // Il visore di chi è già nella videochiamata.
    rr(ctx, cx - 11, 13, 22, 9, 4, INCHIOSTRO);
    rr(ctx, cx - 9, 16, 18, 3, 2, '#0066cc');
    return;
  }
  const tipo = OCCHIALI[look.occhiali] ?? 'nessuno';
  if (tipo === 'occhiali') {
    ctx.save();
    ctx.strokeStyle = INCHIOSTRO;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.roundRect(cx - 8, 15, 7, 6, 2);
    ctx.roundRect(cx + 1, 15, 7, 6, 2);
    ctx.moveTo(cx - 1, 17);
    ctx.lineTo(cx + 1, 17);
    ctx.stroke();
    ctx.restore();
  } else if (tipo === 'sole') {
    rr(ctx, cx - 9, 15, 8, 6, 2.5, SCURO);
    rr(ctx, cx + 1, 15, 8, 6, 2.5, SCURO);
    rr(ctx, cx - 1, 16, 2, 1.5, 0.5, SCURO);
    rr(ctx, cx - 7, 16, 2.5, 1.5, 0.75, 'rgba(255,255,255,0.5)');
    rr(ctx, cx + 3, 16, 2.5, 1.5, 0.75, 'rgba(255,255,255,0.5)');
  }
}

function cappelloFronte(ctx: Ctx, cappello: string, t: Tinte, cx: number, spalle: boolean): void {
  switch (cappello) {
    case 'berretto':
      ellisse(ctx, cx, 9.5, 12, 7.5, t.cappello);
      if (!spalle) {
        rr(ctx, cx - 13, 11, 26, 4, 2, t.cappelloOmbra);
        cerchio(ctx, cx, 6.5, 1.8, BIANCO);
      } else {
        rr(ctx, cx - 3, 13, 6, 2, 1, t.cappelloOmbra);
      }
      return;
    case 'cuffia':
      rr(ctx, cx - 12, 2.5, 24, 12, 8, t.cappello);
      rr(ctx, cx - 12.5, 10.5, 25, 5, 2.5, t.cappelloOmbra);
      cerchio(ctx, cx, 2.5, 3.6, BIANCO);
      return;
    case 'cappello':
      ellisse(ctx, cx, 12, 17, 4, t.cappelloOmbra);
      rr(ctx, cx - 9, 0.5, 18, 12, 4, t.cappello);
      rr(ctx, cx - 9, 8, 18, 3, 1, INCHIOSTRO);
      return;
    case 'caschetto':
      ellisse(ctx, cx, 9.5, 12.5, 8.5, '#f2b134');
      rr(ctx, cx - 14, 12, 28, 4, 2, '#d39420');
      rr(ctx, cx - 1, 2, 2, 9, 1, '#ffe08a');
      return;
    case 'cuffie':
      ctx.save();
      ctx.strokeStyle = SCURO;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, 16, 12.5, Math.PI * 1.05, Math.PI * 1.95);
      ctx.stroke();
      ctx.restore();
      rr(ctx, cx - 15, 13, 5, 9, 2.5, t.cappello);
      rr(ctx, cx + 10, 13, 5, 9, 2.5, t.cappello);
      return;
    case 'corona':
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      ctx.moveTo(cx - 9, 9);
      ctx.lineTo(cx - 9, 1);
      ctx.lineTo(cx - 4.5, 5);
      ctx.lineTo(cx, -1);
      ctx.lineTo(cx + 4.5, 5);
      ctx.lineTo(cx + 9, 1);
      ctx.lineTo(cx + 9, 9);
      ctx.closePath();
      ctx.fill();
      if (!spalle) cerchio(ctx, cx, 5.5, 1.8, '#d9364f');
      return;
    default:
      return;
  }
}

// ── di profilo (verso sinistra) ────────────────────────────────────────────

function profilo(ctx: Ctx, look: AvatarLook, t: Tinte, passo: number, inCall: boolean): void {
  const cx = AV_W / 2;
  const maglia = MAGLIE[look.maglia] ?? 'maglietta';
  const sotto = SOTTO[look.sotto] ?? 'pantaloni';
  const stile = CAPELLI[look.capelli] ?? 'corti';
  const cappello = CAPPELLI[look.cappello] ?? 'nessuno';
  const gonna = maglia === 'vestito' || sotto === 'gonna';
  const gambeNude = gonna || sotto === 'pantaloncini';
  // Il passo: le gambe si aprono, il braccio va avanti e indietro.
  const apertura = passo === 0 ? 0 : 5;
  const braccio = passo === 1 ? -4 : passo === 2 ? 4 : 0;

  // Capelli lunghi e coda dietro il busto.
  if (stile === 'lunghi') rr(ctx, cx - 1, 9, 13, 27, 6, t.capelli);
  if (stile === 'coda') ellisse(ctx, cx + 11, 17, 4, 9, t.capelli);

  // Gambe: quella dietro un po' più scura.
  const gambe: [number, string][] = [
    [cx - 3 + apertura * (passo === 1 ? 1 : -1), gambeNude ? t.pelleOmbra : t.sottoOmbra],
    [cx - 3 - apertura * (passo === 1 ? 1 : -1), gambeNude ? t.pelle : t.sotto],
  ];
  for (const [x, colore] of gambe) {
    rr(ctx, x, 44, 7, 15, 3, colore);
    if (sotto === 'pantaloncini' && !gonna) rr(ctx, x, 44, 7, 7, 2, t.sotto);
    rr(ctx, x - 3, 55, 10, 6, 3, t.scarpe);
  }
  if (gonna) {
    const colore = maglia === 'vestito' ? t.sopra : t.sotto;
    ctx.fillStyle = colore;
    ctx.beginPath();
    ctx.moveTo(cx - 7, 42);
    ctx.lineTo(cx + 6, 42);
    ctx.lineTo(cx + 9, 54);
    ctx.quadraticCurveTo(cx, 57, cx - 11, 54);
    ctx.closePath();
    ctx.fill();
  }
  // Busto.
  rr(ctx, cx - 8, 28, 15, 20, 6, t.sopra);
  contorno(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(cx - 8, 28, 15, 20, 6);
  });
  if (maglia === 'felpa') rr(ctx, cx - 2, 26, 9, 7, 3, t.sopraOmbra);
  if (maglia === 'camicia') rr(ctx, cx - 6, 27, 6, 3, 1.5, BIANCO);
  if (maglia === 'giacca') rr(ctx, cx - 8, 29, 3, 15, 1.5, BIANCO);
  if (sotto !== 'gonna' && maglia !== 'vestito') rr(ctx, cx - 8, 44, 15, 4, 2, t.sotto);
  // Il braccio davanti.
  const maniche = maglia === 'maglietta' || maglia === 'vestito' ? 7 : 14;
  ctx.save();
  ctx.translate(cx - 1, 31);
  ctx.rotate((braccio * Math.PI) / 60);
  rr(ctx, -3, -1, 6, 16, 3, t.pelle);
  rr(ctx, -3, -1, 6, maniche, 3, t.sopra);
  cerchio(ctx, 0, 15, 2.6, t.pelle);
  ctx.restore();

  // Collo, testa, faccia.
  rr(ctx, cx - 3, 24, 6, 6, 2, t.pelle);
  cerchio(ctx, cx - 1, 17, 11, t.pelle);
  contorno(ctx, () => {
    ctx.beginPath();
    ctx.arc(cx - 1, 17, 11, 0, Math.PI * 2);
  });
  cerchio(ctx, cx - 11.5, 19, 2.2, t.pelle); // il naso
  cerchio(ctx, cx - 6, 17.5, 1.7, t.occhi);
  ctx.save();
  ctx.strokeStyle = t.bocca;
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 9, 22.5);
  ctx.lineTo(cx - 6.5, 22.5);
  ctx.stroke();
  ctx.restore();

  // Capelli di profilo: la calotta va verso la nuca.
  switch (stile) {
    case 'calvo':
      ellisse(ctx, cx + 1, 9, 3, 1.5, 'rgba(255,255,255,0.45)');
      break;
    case 'rasati':
      ellisse(ctx, cx + 1, 10, 10, 5.5, t.capelliOmbra);
      break;
    case 'ricci':
      if (cappello === 'nessuno') {
        for (const [x, y, r] of [
          [cx - 7, 8, 5],
          [cx, 6, 6],
          [cx + 6, 9, 6],
          [cx + 8, 16, 5],
          [cx + 4, 21, 4],
        ] as const) {
          cerchio(ctx, x, y, r, t.capelli);
        }
        break;
      }
      ellisse(ctx, cx + 1, 10, 11, 7, t.capelli);
      break;
    case 'caschetto':
      rr(ctx, cx - 9, 5, 21, 21, 9, t.capelli);
      rr(ctx, cx - 12, 12, 7, 12, 3, t.pelle);
      cerchio(ctx, cx - 6, 17.5, 1.7, t.occhi);
      break;
    default:
      ellisse(ctx, cx + 1, 10, 11, 7, t.capelli);
      rr(ctx, cx + 2, 10, 8, 11, 4, t.capelli);
      if (stile === 'chignon' && cappello === 'nessuno') cerchio(ctx, cx + 6, 4, 5, t.capelli);
      if (stile === 'coda') rr(ctx, cx + 8, 12, 3, 3, 1, SCURO);
      break;
  }
  cerchio(ctx, cx + 3, 18, 2.4, t.pelleOmbra); // l'orecchio

  // Occhiali e visore.
  const tipo = OCCHIALI[look.occhiali] ?? 'nessuno';
  if (inCall) {
    rr(ctx, cx - 12, 13, 15, 8, 4, INCHIOSTRO);
    rr(ctx, cx - 11, 16, 9, 3, 1.5, '#0066cc');
  } else if (tipo !== 'nessuno') {
    if (tipo === 'sole') rr(ctx, cx - 10, 15, 7, 5.5, 2.5, SCURO);
    ctx.save();
    ctx.strokeStyle = tipo === 'sole' ? SCURO : INCHIOSTRO;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (tipo === 'occhiali') ctx.roundRect(cx - 10, 15, 7, 6, 2);
    ctx.moveTo(cx - 3, 17);
    ctx.lineTo(cx + 2, 17);
    ctx.stroke();
    ctx.restore();
  }

  // Cappelli di profilo.
  switch (cappello) {
    case 'berretto':
      ellisse(ctx, cx + 1, 9.5, 11.5, 7.5, t.cappello);
      rr(ctx, cx - 17, 11, 13, 4, 2, t.cappelloOmbra);
      break;
    case 'cuffia':
      rr(ctx, cx - 11, 2.5, 23, 12, 8, t.cappello);
      rr(ctx, cx - 11.5, 10.5, 24, 5, 2.5, t.cappelloOmbra);
      cerchio(ctx, cx + 1, 2.5, 3.6, BIANCO);
      break;
    case 'cappello':
      ellisse(ctx, cx - 1, 12, 17, 3.5, t.cappelloOmbra);
      rr(ctx, cx - 9, 0.5, 17, 12, 4, t.cappello);
      rr(ctx, cx - 9, 8, 17, 3, 1, INCHIOSTRO);
      break;
    case 'caschetto':
      ellisse(ctx, cx, 9.5, 12, 8.5, '#f2b134');
      rr(ctx, cx - 16, 12, 28, 4, 2, '#d39420');
      break;
    case 'cuffie':
      ctx.save();
      ctx.strokeStyle = SCURO;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx + 1, 17, 12, Math.PI * 1.15, Math.PI * 1.9);
      ctx.stroke();
      ctx.restore();
      rr(ctx, cx, 13, 7, 10, 3, t.cappello);
      break;
    case 'corona':
      ctx.fillStyle = '#f2c230';
      ctx.beginPath();
      ctx.moveTo(cx - 9, 9);
      ctx.lineTo(cx - 9, 1);
      ctx.lineTo(cx - 4, 5);
      ctx.lineTo(cx, -1);
      ctx.lineTo(cx + 4, 5);
      ctx.lineTo(cx + 8, 1);
      ctx.lineTo(cx + 8, 9);
      ctx.closePath();
      ctx.fill();
      cerchio(ctx, cx - 4, 6, 1.6, '#d9364f');
      break;
    default:
      break;
  }
}
