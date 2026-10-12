import * as Phaser from 'phaser';

import { AV_H, AV_W, DIREZIONI, disegnaPersonaggio, PASSI } from '../avatar/disegno';
import { codificaLook, type AvatarLook } from '../avatar/look';

/**
 * AvatarTextureFactory — l'unico punto in cui un aspetto diventa texture.
 *
 * Il disegno sta in `avatar/disegno` (vettoriale piatto, tre direzioni per tre
 * passi); qui lo si dipinge su un canvas a risoluzione doppia, così resta
 * nitido quando la telecamera avvicina, con un fotogramma per direzione e
 * passo. Una texture per aspetto: ottanta persone con aspetti uguali
 * condividono le stesse.
 */

export const AVATAR_W = AV_W;
export const AVATAR_H = AV_H;
/** La risoluzione della texture rispetto al mondo (lo sprite la riduce). */
export const AVATAR_RISOLUZIONE = 2;

/** I colori della maglia della barra di personalizzazione (piazza da sola). */
export const AVATAR_COLORS = [
  '#0066CC',
  '#D9364F',
  '#008758',
  '#7B5AAE',
  '#F7A11A',
  '#17324D',
  '#5A768A',
  '#3A5472',
] as const;

export interface AvatarAppearance {
  look: AvatarLook;
  /** Il visore, per chi è già nella videochiamata. */
  inCall: boolean;
}

export function appearanceKey(a: AvatarAppearance): string {
  return `avatar:${codificaLook(a.look)}:${a.inCall ? 1 : 0}`;
}

/** Il fotogramma per direzione e passo (la destra è la sinistra specchiata). */
export function avatarFrame(facing: 'down' | 'up' | 'left' | 'right', passo: number): number {
  const d = facing === 'down' ? 0 : facing === 'up' ? 1 : 2;
  return d * PASSI + Math.max(0, Math.min(PASSI - 1, passo));
}

// Quanti personaggi usano ciascuna texture: quando nessuno la usa più si
// libera (ogni cambio nell'editor, di chiunque in piazza, ne crea una nuova).
const usi = new WeakMap<Phaser.Textures.TextureManager, Map<string, number>>();

function contatori(scene: Phaser.Scene): Map<string, number> {
  let m = usi.get(scene.textures);
  if (!m) {
    m = new Map();
    usi.set(scene.textures, m);
  }
  return m;
}

/** Prende la texture di un aspetto (creandola se serve) e ne conta l'uso. */
export function acquireAvatarTexture(scene: Phaser.Scene, a: AvatarAppearance): string {
  const key = ensureAvatarTexture(scene, a);
  const m = contatori(scene);
  m.set(key, (m.get(key) ?? 0) + 1);
  return key;
}

/** Lascia la texture; l'ultimo che la lascia la toglie. */
export function releaseAvatarTexture(scene: Phaser.Scene, key: string): void {
  const m = contatori(scene);
  const resto = (m.get(key) ?? 0) - 1;
  if (resto > 0) {
    m.set(key, resto);
    return;
  }
  m.delete(key);
  if (scene.textures.exists(key)) scene.textures.remove(key);
}

/** La texture di questo aspetto (creata la prima volta); restituisce la chiave. */
export function ensureAvatarTexture(scene: Phaser.Scene, a: AvatarAppearance): string {
  const key = appearanceKey(a);
  if (scene.textures.exists(key)) return key;
  const r = AVATAR_RISOLUZIONE;
  const fw = AV_W * r;
  const fh = AV_H * r;
  const n = DIREZIONI.length * PASSI;
  const canvas = document.createElement('canvas');
  canvas.width = fw * n;
  canvas.height = fh;
  const c2d = canvas.getContext('2d');
  if (!c2d) return key;
  DIREZIONI.forEach((dir, d) => {
    for (let p = 0; p < PASSI; p++) {
      disegnaPersonaggio(c2d, a.look, dir, p, a.inCall, r, (d * PASSI + p) * fw, 0);
    }
  });
  const tex = scene.textures.addCanvas(key, canvas);
  if (!tex) return key;
  for (let i = 0; i < n; i++) tex.add(i, 0, i * fw, 0, fw, fh);
  return key;
}
