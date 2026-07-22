import * as Phaser from 'phaser';

import { busOn } from '../bus';
import { PRESENCE_INTERVAL_MS } from '../constants';
import { getContext, type LobbyContext } from '../context';
import type { DeviceSelection, EmoteType, Facing } from '../ports/types';
import { AvatarSprite } from '../systems/AvatarSprite';
import { CountdownGate } from '../systems/CountdownGate';
import { applyNametagCulling, type CullEntry } from '../systems/NametagCulling';
import { PeerStore, type MergedPeer, type PeerStoreEvent } from '../systems/PeerStore';
import { ProximityLinks } from '../systems/ProximityLinks';
import { buildPlaceholderMap, type Collider, type WorldLayout } from '../systems/WorldMap';
import { buildPiazzaMap } from '../systems/PiazzaMap';
import { Movement } from '../systems/Movement';

/** Margin (px) around the camera view within which avatars stay un-culled. */
const VIEW_MARGIN = 96;
const SEAT_GLIDE = 0.12;

export class WorldScene extends Phaser.Scene {
  private ctx!: LobbyContext;
  private layout!: WorldLayout;
  private local!: AvatarSprite;
  private movement!: Movement;
  private store!: PeerStore;
  private links!: ProximityLinks;
  private gate!: CountdownGate;

  private readonly sprites = new Map<string, AvatarSprite>();
  private readonly pool: AvatarSprite[] = [];
  private readonly cullScratch: CullEntry[] = [];

  private localPos = { x: 0, y: 0 };
  private moveAccum = 0;
  private inGateZone = false;
  private lastPeerCount = -1;

  // Seats (amphitheatre) for inCall avatars.
  private freeSeats: number[] = [];
  private initialSeatCount = 0;
  private readonly seatOf = new Map<string, number>();

  // Local join state.
  private localInCall = false;
  private joining = false;
  private localSeat: { x: number; y: number } | null = null;

  private readonly busUnsubs: (() => void)[] = [];

  constructor() {
    super('World');
  }

  create(): void {
    this.ctx = getContext(this);
    const world = this.ctx.config.worldSize;

    const cam = this.cameras.main;
    cam.setBounds(0, 0, world.w, world.h);

    // Map theme: "piazza" (default — .italia pastel civic square) or the legacy
    // "classic" garden+theatre. buildPiazzaMap sets its own pastel camera bg.
    const useClassic = this.ctx.config.map === 'classic';
    if (useClassic) cam.setBackgroundColor('#26344a');
    this.layout = useClassic
      ? buildPlaceholderMap(this, world)
      : buildPiazzaMap(this, world);
    this.initialSeatCount = this.layout.seats.length;
    this.freeSeats = this.layout.seats.map((_, i) => i).reverse();

    // Local player.
    this.localPos = { ...this.layout.spawn };
    this.local = new AvatarSprite(
      this,
      this.localPos.x,
      this.localPos.y,
      this.ctx.getProfile(),
      false,
      { isSelf: true },
    );
    this.local.setNameVisible(true);

    this.applyCameraZoom();
    cam.startFollow(this.local.container, true, 0.14, 0.14);
    cam.setDeadzone(220, 160);

    this.movement = new Movement(world, {
      onJump: () => {
        if (!this.localInCall) {
          this.local.jump();
          this.ctx.audio.jump();
        }
      },
      onEmote: (type) => this.localEmote(type),
    });

    this.links = new ProximityLinks(this);
    this.gate = new CountdownGate(this, this.layout, this.ctx.schedule, this.ctx.bus);

    // Presence/conference reconciliation.
    this.store = new PeerStore(
      this.ctx.presence,
      this.ctx.conference,
      (e) => this.onPeerEvent(e),
    );
    this.store.start();
    for (const peer of this.store.values()) this.onPeerEvent({ type: 'add', peer });

    // UI → scene wiring.
    this.busUnsubs.push(
      busOn(this.ctx.bus, 'profileChange', () => this.local.setProfile(this.ctx.getProfile())),
      busOn(this.ctx.bus, 'joinRequest', (sel) => void this.handleJoin(sel)),
      busOn(this.ctx.bus, 'emote', (type) => this.localEmote(type)),
      busOn(this.ctx.bus, 'joyAxis', (a) => this.movement.setExternalAxis(a.x, a.y)),
    );

    this.scale.on('resize', this.applyCameraZoom, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  // ── per-frame ──
  override update(_time: number, delta: number): void {
    // Use performance.now() for ALL animation/interpolation/emote timing so the
    // timebase matches the event callbacks (which also use performance.now()).
    const animNow = performance.now();

    // Local movement (suspended once seated in the call).
    if (!this.localInCall) {
      const colliders = this.colliders();
      const r = this.movement.update(delta, this.localPos, colliders);
      this.localPos.x = r.x;
      this.localPos.y = r.y;
      this.local.setLocal(r.x, r.y, r.facing, r.moving);
      this.emitGateZone(r.x, r.y);
      this.throttledMove(delta, r.x, r.y, r.facing);
      this.ctx.audio.footstep(delta, r.moving);
    } else if (this.localSeat) {
      // Glide to the assigned stage seat, then settle.
      this.localPos.x += (this.localSeat.x - this.localPos.x) * SEAT_GLIDE;
      this.localPos.y += (this.localSeat.y - this.localPos.y) * SEAT_GLIDE;
      this.local.setLocal(this.localPos.x, this.localPos.y, 'down', false);
    }
    this.local.update(delta, animNow);

    // Peers: poll positions, interest-cull, animate.
    this.store.syncPositions();
    const view = this.cameras.main.worldView;
    this.cullScratch.length = 0;
    for (const peer of this.store.values()) {
      const sprite = this.sprites.get(peer.id);
      if (!sprite) continue;
      this.placePeer(sprite, peer, animNow);

      const inView = rectContainsMargin(view, sprite.x, sprite.y, VIEW_MARGIN);
      sprite.setCulled(!inView);
      if (inView) {
        sprite.update(delta, animNow);
        this.cullScratch.push({ sprite, inCall: peer.inCall });
      }
    }

    applyNametagCulling(this.localPos.x, this.localPos.y, this.cullScratch);
    this.links.update(this.localPos.x, this.localPos.y, this.sprites.values());
    this.gate.update(Date.now(), delta);
    this.emitPeerCount();
  }

  // ── peers ──
  private onPeerEvent(e: PeerStoreEvent): void {
    switch (e.type) {
      case 'add': {
        if (this.sprites.has(e.peer.id)) return;
        if (e.peer.inCall) this.assignSeat(e.peer.id);
        const { x, y } = this.spawnPos(e.peer);
        this.sprites.set(e.peer.id, this.acquireSprite(e.peer, x, y));
        break;
      }
      case 'remove': {
        const sprite = this.sprites.get(e.id);
        if (sprite) {
          this.sprites.delete(e.id);
          this.releaseSeat(e.id);
          this.recycleSprite(sprite);
        }
        break;
      }
      case 'profile': {
        this.sprites.get(e.peer.id)?.setProfile(e.peer);
        break;
      }
      case 'inCall': {
        const sprite = this.sprites.get(e.peer.id);
        if (!sprite) break;
        sprite.setInCall(e.peer.inCall);
        if (e.peer.inCall) this.assignSeat(e.peer.id);
        else this.releaseSeat(e.peer.id);
        break;
      }
      case 'emote': {
        this.sprites.get(e.id)?.showEmote(e.emote, performance.now());
        break;
      }
    }
  }

  /** Where a peer's sprite should aim this frame: a seat if inCall, else garden. */
  private placePeer(sprite: AvatarSprite, peer: MergedPeer, now: number): void {
    if (peer.inCall) {
      const seatIdx = this.seatOf.get(peer.id);
      const seat = seatIdx !== undefined ? this.layout.seats[seatIdx] : undefined;
      if (seat) {
        sprite.setTarget(seat.x, seat.y, 'down', now);
        return;
      }
    }
    sprite.setTarget(peer.x, peer.y, peer.facing, now);
  }

  private spawnPos(peer: MergedPeer): { x: number; y: number } {
    if (peer.inCall) {
      const idx = this.seatOf.get(peer.id);
      const seat = idx !== undefined ? this.layout.seats[idx] : undefined;
      if (seat) return { x: seat.x, y: seat.y };
    }
    return { x: peer.x, y: peer.y };
  }

  private acquireSprite(peer: MergedPeer, x: number, y: number): AvatarSprite {
    const reused = this.pool.pop();
    if (reused) {
      reused.reset(peer, x, y, peer.inCall);
      return reused;
    }
    return new AvatarSprite(this, x, y, peer, peer.inCall, { interpolate: true });
  }

  private recycleSprite(sprite: AvatarSprite): void {
    sprite.park();
    this.pool.push(sprite);
  }

  // ── seats ──
  private assignSeat(id: string): void {
    if (this.seatOf.has(id)) return;
    this.seatOf.set(id, this.nextSeatIndex());
  }

  /** A free seat, or a freshly generated overflow standing spot (so more
   *  in-call people than the initial seats never freeze in the garden). */
  private nextSeatIndex(): number {
    const free = this.freeSeats.pop();
    if (free !== undefined) return free;
    return this.makeOverflowSeat();
  }

  private makeOverflowSeat(): number {
    const seats = this.layout.seats;
    const idx = seats.length;
    const over = idx - this.initialSeatCount;
    const amph = this.layout.amphitheatre;
    const cols = 16;
    const col = over % cols;
    const rowi = Math.floor(over / cols);
    seats.push({
      x: amph.x + 70 + (col / (cols - 1)) * (amph.width - 140),
      y: amph.bottom - 26 - rowi * 32, // stack upward from the hedge, staying on stage
    });
    return idx;
  }

  private releaseSeat(id: string): void {
    const idx = this.seatOf.get(id);
    if (idx === undefined) return;
    this.seatOf.delete(id);
    this.freeSeats.push(idx);
  }

  // ── local join flow ──
  private async handleJoin(sel: DeviceSelection): Promise<void> {
    if (this.joining || this.localInCall) return;
    if (!this.gate.canEnter()) return;
    this.joining = true;
    try {
      await this.ctx.conference.join(sel);
    } catch {
      this.joining = false;
      // Il rifiuto va DIMENTICATO anche sulla zona cancello: `inGateZone` resta
      // true finché non se ne esce, e senza questo l'ingresso camminando
      // diventava una porta che si apre una volta sola — completa il nome nel
      // pannello e il cancello non risponde più, perché nessuno riemette la
      // richiesta. Azzerandolo, il prossimo passo dentro la zona riprova.
      this.inGateZone = false;
      return;
    }
    // Release preview tracks BEFORE the (future) real conference grabs devices.
    this.ctx.media.stop();
    this.localInCall = true;
    this.joining = false;
    this.localSeat = this.takeLocalSeat();
    this.local.setInCall(true);
    this.ctx.audio.chime();
    this.ctx.bus.emit('joined', undefined);
    this.ctx.bus.emit('gateZone', false);
    this.inGateZone = false;
  }

  private takeLocalSeat(): { x: number; y: number } {
    const idx = this.nextSeatIndex();
    return (
      this.layout.seats[idx] ?? {
        x: this.layout.screen.centerX,
        y: this.layout.screen.bottom + 90,
      }
    );
  }

  // ── helpers ──
  private colliders(): Collider[] {
    // The gate stays a barrier for walking — entry is the Entra flow.
    return [...this.layout.staticColliders, this.layout.gateBar];
  }

  private localEmote(type: EmoteType): void {
    this.local.showEmote(type, performance.now());
    this.ctx.presence.emote(type);
    this.ctx.audio.emote();
  }

  private throttledMove(delta: number, x: number, y: number, facing: Facing): void {
    this.moveAccum += delta;
    if (this.moveAccum >= PRESENCE_INTERVAL_MS) {
      this.moveAccum = 0;
      this.ctx.presence.move(x, y, facing);
    }
  }

  private emitGateZone(x: number, y: number): void {
    const inside =
      !this.localInCall && Phaser.Geom.Rectangle.Contains(this.layout.gateTrigger, x, y);
    if (inside !== this.inGateZone) {
      this.inGateZone = inside;
      this.ctx.bus.emit('gateZone', inside);
      // Embed: the host shell suppresses the in-game device panel, so reaching
      // the OPEN gate IS the enter action ("cammina fino al cancello → entra").
      // Fire the same joinRequest the panel would; the host's onEnterLive is
      // validated (name/consent) and owns the real device choice, so the muted
      // defaults here are only a placeholder. The standard host "Entra" button
      // stays available alongside this. Full-screen (dev harness) keeps the
      // explicit device-panel flow instead.
      //
      // Gate strictly on LIVE (not gate.canEnter(), which also opens early for
      // hosts): the host shell's standard "Entra ora" only appears once LIVE,
      // so a moderator must never be auto-entered pre-LIVE by brushing the gate.
      if (inside && this.ctx.config.embed && this.ctx.schedule.getStatus() === 'live') {
        this.ctx.bus.emit('joinRequest', { videoMuted: true, audioMuted: true });
      }
    }
  }

  private emitPeerCount(): void {
    const count = this.sprites.size + 1;
    if (count !== this.lastPeerCount) {
      this.lastPeerCount = count;
      this.ctx.bus.emit('peerCount', count);
    }
  }

  private applyCameraZoom = (): void => {
    const world = this.ctx.config.worldSize;
    const vw = this.scale.width;
    const vh = this.scale.height;
    if (vw <= 0 || vh <= 0) return;
    // Aim to show ~DESIRED_VIEW_H world-px tall so avatars stay a readable size
    // and the world is larger than the viewport (the camera pans). Then raise
    // the zoom enough that the world always fills the viewport (no empty
    // margins) — this also makes it degrade gracefully in a SMALL embedded
    // container instead of showing a tiny sliver of a huge world. Clamp the
    // extremes.
    // Show more of the piazza (smaller avatars/props): frame the FULL world
    // height and pan horizontally. We no longer force the world to fill the
    // viewport — a calm pastel margin reads better than a zoomed-in slice.
    const DESIRED_VIEW_H = world.h;
    let zoom = vh / DESIRED_VIEW_H;
    zoom = Math.min(1.2, Math.max(0.42, zoom));
    this.cameras.main.setZoom(zoom);
  };

  private teardown(): void {
    this.scale.off('resize', this.applyCameraZoom, this);
    for (const u of this.busUnsubs) u();
    this.busUnsubs.length = 0;
    this.movement.destroy();
    this.store.stop();
    this.gate.destroy();
  }
}

function rectContainsMargin(
  view: Phaser.Geom.Rectangle,
  x: number,
  y: number,
  margin: number,
): boolean {
  return (
    x >= view.x - margin &&
    x <= view.right + margin &&
    y >= view.y - margin &&
    y <= view.bottom + margin
  );
}
