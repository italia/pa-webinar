import * as Phaser from 'phaser';

import { INTERP_RATE } from '../constants';
import { EMOTE_GLYPH } from '../emotes';
import type { EmoteType, Facing, PlayerProfile } from '../ports/types';
import { lookDi } from '../avatar/look';
import {
  AVATAR_H,
  AVATAR_RISOLUZIONE,
  AVATAR_W,
  appearanceKey,
  avatarFrame,
  acquireAvatarTexture,
  releaseAvatarTexture,
  type AvatarAppearance,
} from './AvatarTextureFactory';

/** Quanto resta un fumetto: almeno venti secondi, di più per i messaggi
 *  lunghi. Un messaggio nuovo della stessa persona sostituisce il precedente. */
export const FUMETTO_MIN_MS = 20_000;
const FUMETTO_MAX_MS = 30_000;
/** Al caffè, fra chi è al tavolino, i fumetti restano di più: è una
 *  conversazione. */
const FUMETTO_CAFFE_MS = 50_000;
const FUMETTO_MS_PER_CARATTERE = 100;
/** Un messaggio arrivato da poco resta almeno questo, anche se è quasi scaduto. */
const FUMETTO_RESIDUO_MIN_MS = 3000;
const FUMETTO_LARGHEZZA = 190;
const FUMETTO_CARATTERI = 90;
const FUMETTO_Y = -AVATAR_H - 24;
const HOP_MS = 460;
const HOP_HEIGHT = 22;
const EMOTE_MS = 1500;
/** Cap remote extrapolation so a stale target never flings the avatar away. */
const DEAD_RECKON_CAP_MS = 160;

export interface AvatarSpriteOptions {
  isSelf?: boolean;
  /** Remote peers lerp toward their target; the local player is authoritative. */
  interpolate?: boolean;
}

/**
 * One avatar = one Phaser Container holding shadow, body, nametag and an emote
 * bubble. The container's position IS the avatar's ground point (feet); its
 * depth tracks y so the world y-sorts. Art comes from the texture factory, so
 * this class never draws a pixel — it only animates and interpolates.
 */
/** Il testo di un fumetto: su una riga, e tagliato se troppo lungo. */
function accorcia(testo: string): string {
  const pulito = testo.replace(/\s+/g, ' ').trim();
  return pulito.length > FUMETTO_CARATTERI ? `${pulito.slice(0, FUMETTO_CARATTERI - 1)}…` : pulito;
}

export class AvatarSprite {
  readonly container: Phaser.GameObjects.Container;
  private readonly scene: Phaser.Scene;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly body: Phaser.GameObjects.Sprite;
  private readonly nametag: Phaser.GameObjects.Text;
  private readonly emote: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Arc | null;
  // Il fumetto della chat: sfondo disegnato e testo, sopra il nome. Creato
  // la prima volta che serve: molti avatar non scrivono mai.
  private bolla: {
    container: Phaser.GameObjects.Container;
    sfondo: Phaser.GameObjects.Graphics;
    testo: Phaser.GameObjects.Text;
  } | null = null;
  private fumettoFino = 0;
  private fumettoDurata = 0;
  /** Il messaggio nel fumetto: se un moderatore lo nasconde, sparisce. */
  private fumettoId: string | null = null;
  private staScrivendo = false;

  private readonly isSelf: boolean;
  private readonly interpolate: boolean;

  private appearance: AvatarAppearance;
  /** La texture in uso, contata (vedi AvatarTextureFactory). */
  private texKey = '';
  private facing: Facing = 'down';
  private moving = false;
  private walkPhase = 0;
  private hopElapsed = -1;
  private emoteUntil = 0;
  private pinnedName = false; // inCall → name always visible
  private nameWanted = true;
  private culled = false;

  // Interpolation state (remote peers). setTarget may be called every frame
  // with the latest *polled* position; it only registers a new "sample" when
  // the coordinates actually change (≈10Hz), and decays to stationary when they
  // stop, so a paused peer never drifts off its spot.
  private targetX: number;
  private targetY: number;
  private velX = 0;
  private velY = 0;
  private lastSampleAt = 0;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    profile: PlayerProfile,
    inCall: boolean,
    opts: AvatarSpriteOptions = {},
  ) {
    this.scene = scene;
    this.isSelf = opts.isSelf ?? false;
    this.interpolate = opts.interpolate ?? false;
    this.appearance = profileAppearance(profile, inCall);
    this.targetX = x;
    this.targetY = y;

    // Soft navy shadow (low alpha) to stay airy on the pastel piazza floor.
    this.shadow = scene.add.ellipse(0, 0, 28, 11, 0x17324d, 0.14);

    const texKey = acquireAvatarTexture(scene, this.appearance);
    this.texKey = texKey;
    this.body = scene.add
      .sprite(0, 1, texKey, avatarFrame('down', 0))
      .setOrigin(0.5, 1)
      .setScale(1 / AVATAR_RISOLUZIONE);

    this.ring = this.isSelf
      ? scene.add.circle(0, -1, 17).setStrokeStyle(2.5, 0x0066cc, 0.9)
      : null;

    // Nametag: navy ink with a white halo — legible on the light .italia floor
    // (the old white-on-dark tuning vanished on the pale piazza).
    this.nametag = scene.add
      .text(0, -AVATAR_H - 4, displayName(profile, this.isSelf), {
        fontFamily: 'Titillium Web, system-ui, sans-serif',
        fontSize: '13px',
        color: '#17324d',
        stroke: '#ffffff',
        strokeThickness: 4,
        fontStyle: this.isSelf ? 'bold' : 'normal',
      })
      .setOrigin(0.5, 1);

    this.emote = scene.add
      .text(0, -AVATAR_H - 20, '', { fontSize: '24px' })
      .setOrigin(0.5, 1)
      .setVisible(false);

    const children: Phaser.GameObjects.GameObject[] = [this.shadow];
    if (this.ring) children.push(this.ring);
    children.push(this.body, this.nametag, this.emote);

    this.container = scene.add.container(x, y, children);
    this.container.setDepth(y);
  }

  get x(): number {
    return this.container.x;
  }
  get y(): number {
    return this.container.y;
  }

  /** Update identity/appearance (name + colour + accessories). */
  setProfile(profile: PlayerProfile): void {
    this.nametag.setText(displayName(profile, this.isSelf));
    this.applyAppearance(profileAppearance(profile, this.appearance.inCall));
  }

  setInCall(inCall: boolean): void {
    if (inCall === this.appearance.inCall) return;
    this.pinnedName = inCall;
    this.applyAppearance({ ...this.appearance, inCall });
  }

  private applyAppearance(next: AvatarAppearance): void {
    if (appearanceKey(next) === appearanceKey(this.appearance)) {
      this.appearance = next;
      return;
    }
    this.appearance = next;
    this.cambiaTexture(acquireAvatarTexture(this.scene, next), avatarFrame(this.facing, 0));
  }

  /** Passa alla texture nuova, poi lascia la vecchia (che altrimenti
   *  resterebbe in memoria per tutta la visita). */
  private cambiaTexture(key: string, frame: number): void {
    const vecchia = this.texKey;
    this.body.setTexture(key, frame);
    this.texKey = key;
    if (vecchia !== key) releaseAvatarTexture(this.scene, vecchia);
    else releaseAvatarTexture(this.scene, key);
  }

  /** Local authoritative position — applied immediately, no smoothing. */
  setLocal(x: number, y: number, facing: Facing, moving: boolean): void {
    this.container.setPosition(x, y);
    this.facing = facing;
    this.moving = moving;
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Latest polled remote position. Safe to call every frame: a real new sample
   * (changed coords) updates the velocity estimate; an unchanged position that
   * persists decays the avatar to stationary so dead-reckoning never drifts it.
   */
  setTarget(x: number, y: number, facing: Facing, now: number): void {
    const moved = Math.abs(x - this.targetX) > 0.3 || Math.abs(y - this.targetY) > 0.3;
    if (moved) {
      const dt = now - this.lastSampleAt;
      if (this.lastSampleAt > 0 && dt > 0 && dt < 500) {
        this.velX = clamp((x - this.targetX) / dt, -2, 2);
        this.velY = clamp((y - this.targetY) / dt, -2, 2);
      }
      this.targetX = x;
      this.targetY = y;
      this.lastSampleAt = now;
      this.moving = true;
    } else if (now - this.lastSampleAt > 140) {
      this.velX = 0;
      this.velY = 0;
      this.moving = false;
    }
    this.facing = facing;
  }

  jump(): void {
    if (this.hopElapsed < 0) this.hopElapsed = 0;
  }

  showEmote(type: EmoteType, now: number): void {
    // Un gesto di una versione più nuova, che qui non si conosce: si ignora.
    const glifo = EMOTE_GLYPH[type];
    if (!glifo) return;
    this.emote.setText(glifo);
    // Con il fumetto aperto il gesto si sposta di lato, per non coprirlo.
    this.emote.setX(this.bolla?.container.visible ? FUMETTO_LARGHEZZA / 2 + 6 : 0);
    this.emote.setVisible(true).setAlpha(1).setY(-AVATAR_H - 20);
    this.emoteUntil = now + EMOTE_MS;
  }

  /** Un messaggio della chat sopra la testa. `etaMs` è quanto è vecchio: un
   *  messaggio scritto prima di aprire la piazza resta per il tempo che gli
   *  rimane. */
  say(testo: string, now: number, etaMs = 0, id: string | null = null, conversazione = false): void {
    const breve = accorcia(testo);
    if (!breve) return;
    this.disegnaFumetto(breve, false);
    const piena = conversazione
      ? FUMETTO_CAFFE_MS
      : Math.min(FUMETTO_MAX_MS, FUMETTO_MIN_MS + breve.length * FUMETTO_MS_PER_CARATTERE);
    this.fumettoDurata = Math.max(FUMETTO_RESIDUO_MIN_MS, piena - Math.max(0, etaMs));
    this.fumettoFino = now + this.fumettoDurata;
    this.fumettoId = id;
  }

  /** Il testo corretto di un messaggio già nel fumetto; il tempo resta quello. */
  editMessage(id: string, testo: string): void {
    if (this.fumettoId !== id || this.fumettoFino === 0) return;
    const breve = accorcia(testo);
    if (!breve) {
      this.clearMessage(id);
      return;
    }
    this.disegnaFumetto(breve, false);
    this.bolla?.container.setScale(1);
  }

  /** Toglie il fumetto se mostra quel messaggio (nascosto da un moderatore). */
  clearMessage(id: string): void {
    if (this.fumettoId !== id || this.fumettoFino === 0) return;
    this.fumettoFino = 0;
    this.fumettoId = null;
    if (this.staScrivendo) this.disegnaFumetto('• • •', true);
    else this.bolla?.container.setVisible(false);
  }

  /** I puntini di chi sta scrivendo, finché non arriva il messaggio. */
  setTyping(on: boolean): void {
    if (on === this.staScrivendo) return;
    this.staScrivendo = on;
    if (on && this.fumettoFino === 0) this.disegnaFumetto('• • •', true);
    if (!on && this.fumettoFino === 0) this.bolla?.container.setVisible(false);
  }

  private assicuraBolla(): NonNullable<AvatarSprite['bolla']> {
    if (this.bolla) return this.bolla;
    const sfondo = this.scene.add.graphics();
    const testo = this.scene.add
      .text(0, 0, '', {
        fontFamily: 'Titillium Web, system-ui, sans-serif',
        fontSize: '13px',
        color: '#17324d',
        align: 'center',
        wordWrap: { width: FUMETTO_LARGHEZZA - 20, useAdvancedWrap: true },
        maxLines: 3,
      })
      .setOrigin(0.5, 1);
    const container = this.scene.add.container(0, FUMETTO_Y, [sfondo, testo]).setVisible(false);
    // Sotto il gesto, sopra il nome.
    this.container.addAt(container, this.container.getIndex(this.emote));
    this.bolla = { container, sfondo, testo };
    return this.bolla;
  }

  private disegnaFumetto(testo: string, puntini: boolean): void {
    const bolla = this.assicuraBolla();
    bolla.testo.setText(testo).setY(-10);
    const larghezza = Math.min(FUMETTO_LARGHEZZA, Math.max(puntini ? 46 : 60, bolla.testo.width + 20));
    const altezza = bolla.testo.height + 12;
    const g = bolla.sfondo;
    g.clear();
    g.fillStyle(0x17324d, 0.12);
    g.fillRoundedRect(-larghezza / 2 + 2, -altezza - 4, larghezza, altezza, 10);
    g.fillStyle(0xffffff, 1);
    g.lineStyle(1.5, puntini ? 0x9fc3e8 : 0x0066cc, 1);
    g.fillRoundedRect(-larghezza / 2, -altezza - 6, larghezza, altezza, 10);
    g.strokeRoundedRect(-larghezza / 2, -altezza - 6, larghezza, altezza, 10);
    // La punta verso la testa.
    g.fillTriangle(-6, -7, 6, -7, 0, 1);
    g.lineBetween(-6, -6, 0, 1);
    g.lineBetween(6, -6, 0, 1);
    bolla.container.setVisible(true).setAlpha(1).setScale(puntini ? 1 : 0.85);
  }

  /** Requested by culling; reconciled with the inCall pin in update. */
  setNameVisible(v: boolean): void {
    this.nameWanted = v;
  }

  get isCulled(): boolean {
    return this.culled;
  }

  /**
   * Interest management: hide off-screen avatars and skip their per-frame work.
   * Coming back into view snaps to the latest target so a frozen interpolation
   * never visibly "catches up".
   */
  setCulled(c: boolean): void {
    if (c === this.culled) return;
    this.culled = c;
    this.container.setVisible(!c);
    if (!c) {
      this.container.setPosition(this.targetX, this.targetY);
    }
  }

  /** Park into the reuse pool (kept allocated, hidden). */
  park(): void {
    this.container.setVisible(false);
    this.emote.setVisible(false);
    this.bolla?.container.setVisible(false);
    this.fumettoFino = 0;
    this.fumettoId = null;
    this.staScrivendo = false;
    this.culled = true;
  }

  /** Revive from the pool with a fresh identity/position. */
  reset(profile: PlayerProfile, x: number, y: number, inCall: boolean): void {
    this.appearance = profileAppearance(profile, inCall);
    this.pinnedName = inCall;
    this.nameWanted = true;
    this.facing = 'down';
    this.moving = false;
    this.walkPhase = 0;
    this.hopElapsed = -1;
    this.emoteUntil = 0;
    this.velX = 0;
    this.velY = 0;
    this.lastSampleAt = 0;
    this.targetX = x;
    this.targetY = y;
    this.cambiaTexture(acquireAvatarTexture(this.scene, this.appearance), avatarFrame('down', 0));
    this.nametag.setText(displayName(profile, this.isSelf));
    this.emote.setVisible(false);
    this.bolla?.container.setVisible(false);
    this.fumettoFino = 0;
    this.fumettoId = null;
    this.staScrivendo = false;
    this.culled = false;
    this.container.setVisible(true).setPosition(x, y).setDepth(y);
  }

  update(dtMs: number, now: number): void {
    const dt = dtMs / 1000;

    // Interpolate remote peers toward a lightly extrapolated target.
    if (this.interpolate) {
      const elapsed = Math.min(now - this.lastSampleAt, DEAD_RECKON_CAP_MS);
      const ex = this.targetX + this.velX * elapsed;
      const ey = this.targetY + this.velY * elapsed;
      const k = 1 - Math.exp(-INTERP_RATE * dt);
      this.container.x += (ex - this.container.x) * k;
      this.container.y += (ey - this.container.y) * k;
    }

    // La camminata: passo, fermo, l'altro passo, fermo, con un piccolo
    // saltello. Di profilo il personaggio è disegnato verso sinistra: a destra
    // si specchia.
    if (this.moving) this.walkPhase += dt * 9;
    else this.walkPhase = 0;
    const fase = Math.floor(this.walkPhase / (Math.PI / 2)) % 4;
    const passo = this.moving ? ([1, 0, 2, 0][fase] ?? 0) : 0;
    this.body.setFrame(avatarFrame(this.facing, passo));
    this.body.setFlipX(this.facing === 'right');
    const bob = this.moving ? -Math.abs(Math.sin(this.walkPhase)) * 2.2 : 0;

    // Hop.
    let hop = 0;
    let shadowScale = 1;
    if (this.hopElapsed >= 0) {
      this.hopElapsed += dtMs;
      const p = this.hopElapsed / HOP_MS;
      if (p >= 1) {
        this.hopElapsed = -1;
      } else {
        hop = -Math.sin(p * Math.PI) * HOP_HEIGHT;
        shadowScale = 1 - Math.sin(p * Math.PI) * 0.4;
      }
    }
    this.body.setY(1 + bob + hop);
    this.shadow.setScale(shadowScale);

    // Emote float + fade.
    if (this.emote.visible) {
      if (now >= this.emoteUntil) {
        this.emote.setVisible(false);
      } else {
        const remaining = (this.emoteUntil - now) / EMOTE_MS;
        this.emote.setY(-AVATAR_H - 20 - (1 - remaining) * 14);
        this.emote.setAlpha(Math.min(1, remaining * 2));
      }
    }

    // Il fumetto: entra con un piccolo rimbalzo, resta, poi svanisce; i
    // puntini di chi scrive pulsano piano.
    const bolla = this.bolla;
    if (bolla && this.fumettoFino > 0) {
      const resta = this.fumettoFino - now;
      if (resta <= 0) {
        this.fumettoFino = 0;
        this.fumettoId = null;
        if (this.staScrivendo) this.disegnaFumetto('• • •', true);
        else bolla.container.setVisible(false);
      } else {
        const trascorso = this.fumettoDurata - resta;
        const scala = trascorso < 180 ? 0.85 + (trascorso / 180) * 0.15 : 1;
        bolla.container.setScale(scala).setAlpha(Math.min(1, resta / 400));
      }
    } else if (bolla && this.staScrivendo && bolla.container.visible) {
      bolla.container.setAlpha(0.65 + Math.sin(now / 220) * 0.25);
    }

    // Nametag: pinned for inCall, otherwise driven by culling.
    this.nametag.setVisible(this.pinnedName || this.nameWanted);

    // Depth follows feet y so the world y-sorts.
    this.container.setDepth(this.container.y);
  }

  destroy(): void {
    this.container.destroy(true); // destroys all children
    releaseAvatarTexture(this.scene, this.texKey);
  }
}

function displayName(p: PlayerProfile, isSelf: boolean): string {
  return p.name.trim() || (isSelf ? 'Tu' : 'Ospite');
}

function profileAppearance(p: PlayerProfile, inCall: boolean): AvatarAppearance {
  // Un profilo senza aspetto (una versione precedente, la piazza da sola con
  // la sua barra dei colori) si traduce: colore della maglia, caschetto,
  // occhiali.
  return { look: lookDi(p), inCall };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Re-export so other systems can size things to the avatar without reaching
// into the factory.
export { AVATAR_W, AVATAR_H };
