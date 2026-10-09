import * as Phaser from 'phaser';

import { busOn } from '../bus';
import { PRESENCE_INTERVAL_MS } from '../constants';
import { getContext, type ChatBubble, type LobbyContext } from '../context';
import type { DeviceSelection, EmoteType, Facing } from '../ports/types';
import { AvatarSprite } from '../systems/AvatarSprite';
import { Atmosfera } from '../systems/Atmosfera';
import { contaUmori, eUmore, UMORE_GLIFO, UMORI, type Umore } from '../umori';
import { Luoghi } from '../systems/Luoghi';
import { lookDi, type AvatarLook } from '../avatar/look';
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
  private luoghi: Luoghi | null = null;
  private atmosfera: Atmosfera | null = null;
  private cartelloUmori: Phaser.GameObjects.Text[] = [];
  private ultimiUmori = '';

  private readonly sprites = new Map<string, AvatarSprite>();
  private readonly pool: AvatarSprite[] = [];
  private readonly cullScratch: CullEntry[] = [];

  private localPos = { x: 0, y: 0 };
  private moveAccum = 0;
  private inGateZone = false;
  /** Gia' chiesto l'ingresso da quando l'avatar e' entrato nella zona. */
  private ingressoChiesto = false;
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
  private ultimoStato: string | null = null;

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
      : buildPiazzaMap(this, world, this.ctx.config.labels);
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
      onInteract: () => {
        const luogo = this.luoghi?.vicino;
        if (luogo && !this.localInCall) this.ctx.bus.emit('interagisci', luogo.id);
      },
    });
    if (this.layout.luoghi?.length) this.luoghi = new Luoghi(this, this.layout.luoghi, this.ctx.bus);
    if (this.ctx.config.map !== 'classic') this.atmosfera = new Atmosfera(this, this.layout, this.ctx.bus);

    this.links = new ProximityLinks(this);
    this.gate = new CountdownGate(
      this,
      this.layout,
      this.ctx.schedule,
      this.ctx.bus,
      this.ctx.config.labels,
    );

    // Presence/conference reconciliation.
    this.store = new PeerStore(
      this.ctx.presence,
      this.ctx.conference,
      (e) => this.onPeerEvent(e),
    );
    this.store.start();
    for (const peer of this.store.values()) this.onPeerEvent({ type: 'add', peer });

    // Lo stato di partenza: il jingle suona solo a un'apertura vera.
    this.ultimoStato = this.ctx.schedule.getStatus();

    // UI → scene wiring.
    this.busUnsubs.push(
      busOn(this.ctx.bus, 'profileChange', () => this.local.setProfile(this.ctx.getProfile())),
      busOn(this.ctx.bus, 'joinRequest', (sel) => void this.handleJoin(sel)),
      busOn(this.ctx.bus, 'emote', (type) => this.localEmote(type)),
      busOn(this.ctx.bus, 'joyAxis', (a) => this.movement.setExternalAxis(a.x, a.y)),
      // Aspettare davanti al cordone e' la posizione naturale, ed era un vicolo
      // cieco: `emitGateZone` parla solo sul FRONTE: chi e' gia' dentro la zona
      // quando il cancello si apre non genera nessun fronte, e le porte si
      // aprivano su un ingresso che non partiva. Qui si chiude quel buco —
      // l'apertura stessa vale come arrivo al cancello.
      busOn(this.ctx.bus, 'statusChange', (s) => {
        this.chiediIngressoSeAlCancello();
        // Il cancello che si apre si sente, una volta.
        if (s === 'live' && this.ultimoStato !== 'live') {
          this.ctx.audio.gateOpen();
          this.atmosfera?.fuochi();
        }
        this.ultimoStato = s;
      }),
      busOn(this.ctx.bus, 'chatMessage', (m) => this.fumetto(m)),
      busOn(this.ctx.bus, 'chatClear', (id) => {
        this.local.clearMessage(id);
        for (const s of this.sprites.values()) s.clearMessage(id);
      }),
      busOn(this.ctx.bus, 'chatEdit', ({ id, text }) => {
        this.local.editMessage(id, text);
        for (const s of this.sprites.values()) s.editMessage(id, text);
      }),
      busOn(this.ctx.bus, 'chatTyping', (nomi) => this.scrivono(nomi)),
      busOn(this.ctx.bus, 'azione', (id) => this.azione(id)),
      busOn(this.ctx.bus, 'festa', () => {
        this.luoghi?.festa(this.localPos.x, this.localPos.y);
        this.ctx.audio.festa();
      }),
    );

    this.scale.on('resize', this.applyCameraZoom, this);
    // `game.destroy()` emette DESTROY, non SHUTDOWN: le pulizie (ascoltatori
    // sul documento compresi) devono girare in tutti e due i casi, una volta.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
    // Il cartello dell'umore legge chi è in piazza: dopo che la scena li conosce.
    this.creaCartelloUmori();
    this.ctx.bus.emit('sceneReady');
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
      this.luoghi?.update(r.x, r.y);
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
      // `inGateZone` resta VOLUTAMENTE true. Azzerarlo qui sembrava gentile
      // («completa il nome e riprova senza muoverti») ma `emitGateZone` gira a
      // ogni frame e riemette sul FRONTE: con l'avatar fermo dentro la zona
      // ripartirebbe sessanta volte al secondo, e ogni tentativo respinto
      // rimette il fuoco sul campo del nome — impossibile perfino correggere
      // l'email. Si riarma uscendo dalla zona e rientrando: un passo indietro.
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
    this.ingressoChiesto = false;
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

  /** Un'azione chiesta dalla pagina, con il suo effetto nella scena. */
  private azione(id: string): void {
    if (this.localInCall) return;
    const luogo = this.layout.luoghi?.find((l) => l.id === id);
    if (!luogo) return;
    if (id === 'caffe') {
      this.localEmote('caffe');
    } else if (id === 'fontana' || id === 'pozzo') {
      this.luoghi?.moneta(this.localPos, luogo);
      this.ctx.audio.moneta();
    }
  }

  /** Quanti per ciascun umore, fra chi è in piazza (io compreso). */
  umori(): Record<Umore, number> {
    // Se il servizio di presenza li conta lui (e allora non dice l'umore dei
    // singoli), valgono i suoi conteggi; altrimenti si contano qui.
    const daServizio = this.ctx.presence.getUmori?.();
    if (daServizio) {
      const conti = contaUmori([]);
      for (const u of UMORI) conti[u] = Math.max(0, Math.floor(Number(daServizio[u]) || 0));
      return conti;
    }
    const lista: (Umore | null | undefined)[] = [this.ctx.getProfile().umore];
    for (const peer of this.store.values()) lista.push(eUmore(peer.umore) ? peer.umore : null);
    return contaUmori(lista);
  }

  /** Il cartello dell'umore accanto al laboratorio: solo i conteggi. */
  private creaCartelloUmori(): void {
    const lab = this.layout.luoghi?.find((l) => l.id === 'laboratorio');
    if (!lab) return;
    const x = lab.x + 205;
    const y = lab.y - 110;
    const g = this.add.graphics().setDepth(y + 60);
    g.fillStyle(0x17324d, 0.1);
    g.fillEllipse(x, y + 60, 90, 16);
    g.fillStyle(0x17324d, 1);
    g.fillRect(x - 3, y + 20, 6, 40);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(x - 56, y - 30, 112, 56, 10);
    g.lineStyle(2, 0x17324d, 1);
    g.strokeRoundedRect(x - 56, y - 30, 112, 56, 10);
    UMORI.forEach((u, i) => {
      const t = this.add
        .text(x - 26 + (i % 2) * 52, y - 16 + Math.floor(i / 2) * 26, `${UMORE_GLIFO[u]} 0`, {
          fontFamily: 'Titillium Web, system-ui, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#17324d',
        })
        .setOrigin(0.5)
        .setDepth(y + 61);
      this.cartelloUmori.push(t);
    });
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.aggiornaCartelloUmori() });
    this.aggiornaCartelloUmori();
  }

  private aggiornaCartelloUmori(): void {
    const conti = this.umori();
    const firma = UMORI.map((u) => conti[u]).join(',');
    if (firma === this.ultimiUmori) return;
    this.ultimiUmori = firma;
    UMORI.forEach((u, i) => this.cartelloUmori[i]?.setText(`${UMORE_GLIFO[u]} ${conti[u]}`));
  }

  /** Chi c'è in piazza adesso: io per primo, poi gli altri. */
  presenti(): { nome: string; look: AvatarLook; io: boolean }[] {
    const io = this.ctx.getProfile();
    const lista = [{ nome: io.name, look: lookDi(io), io: true }];
    for (const peer of this.store.values()) {
      lista.push({ nome: peer.name, look: lookDi(peer), io: false });
    }
    return lista;
  }

  private localEmote(type: EmoteType): void {
    this.local.showEmote(type, performance.now());
    this.ctx.presence.emote(type);
    this.ctx.audio.emote(type);
  }

  // ── chat: fumetti e puntini ──
  // Chi ha scritto si riconosce dal nome mostrato, lo stesso in chat e in
  // piazza; se due persone hanno lo stesso nome, il fumetto compare su
  // entrambe.
  private avatarDi(nome: string): AvatarSprite[] {
    const chiave = normalizzaNome(nome);
    if (!chiave) return [];
    const trovati: AvatarSprite[] = [];
    if (normalizzaNome(this.ctx.getProfile().name) === chiave) trovati.push(this.local);
    for (const peer of this.store.values()) {
      if (normalizzaNome(peer.name) !== chiave) continue;
      const sprite = this.sprites.get(peer.id);
      if (sprite) trovati.push(sprite);
    }
    return trovati;
  }

  private fumetto(m: ChatBubble, suono = true): void {
    // Il mio messaggio va sul mio avatar, qualunque nome mostri la chat.
    const avatar = m.self ? [this.local] : this.avatarDi(m.name);
    if (avatar.length === 0) return;
    const ora = performance.now();
    // Al caffè si chiacchiera: se ci sono sia chi scrive sia chi legge, il
    // fumetto resta di più.
    const caffe = this.layout.luoghi?.find((l) => l.id === 'caffe');
    const alCaffe = (x: number, y: number): boolean =>
      !!caffe && Math.hypot(x - caffe.x, y - caffe.y) < caffe.raggio * 1.6;
    const ioAlCaffe = alCaffe(this.localPos.x, this.localPos.y);
    for (const a of avatar) a.say(m.text, ora, m.ageMs ?? 0, m.id ?? null, ioAlCaffe && alCaffe(a.x, a.y));
    // Il «pop» solo se il fumetto si vede.
    if (suono && avatar.some((a) => !a.isCulled)) this.ctx.audio.pop();
  }

  private scrivono(nomi: string[]): void {
    // Un nome vuoto non deve accendere i puntini di tutti gli anonimi.
    const chiavi = new Set(nomi.map(normalizzaNome).filter(Boolean));
    const io = normalizzaNome(this.ctx.getProfile().name);
    this.local.setTyping(!!io && chiavi.has(io));
    for (const peer of this.store.values()) {
      this.sprites.get(peer.id)?.setTyping(chiavi.has(normalizzaNome(peer.name)));
    }
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
      // Uscire dalla zona riarma la richiesta: e' il «passo indietro» che
      // permette di riprovare dopo aver corretto nome o email.
      if (!inside) this.ingressoChiesto = false;
      this.ctx.bus.emit('gateZone', inside);
      // Embed: the host shell suppresses the in-game device panel, so reaching
      // the OPEN gate IS the enter action ("cammina fino al cancello → entra").
      // Fire the same joinRequest the panel would; the host's onEnterLive is
      // validated (name/consent) and owns the real device choice, so the muted
      // defaults here are only a placeholder. The standard host "Entra" button
      // stays available alongside this. Full-screen (dev harness) keeps the
      // explicit device-panel flow instead.
      this.chiediIngressoSeAlCancello();
    }
  }

  /**
   * Chiede l'ingresso se l'avatar e' fermo dentro la zona del cancello e il
   * cancello e' aperto. La chiamano due cose: l'arrivo al cancello e
   * l'apertura del cancello su chi e' gia' li'.
   *
   * Gate rigorosamente su LIVE (non `gate.canEnter()`, che si apre in anticipo
   * anche per gli host): il pulsante «Entra ora» della shell compare solo a
   * evento avviato, e un moderatore non deve trovarsi dentro per aver sfiorato
   * il cancello prima.
   */
  private chiediIngressoSeAlCancello(): void {
    if (!this.inGateZone || !this.ctx.config.embed) return;
    if (this.joining || this.localInCall) return;
    if (this.ctx.schedule.getStatus() !== 'live') return;
    // Una sola richiesta per arrivo: lo stato della sala arriva da un
    // sondaggio e puo' oscillare, e ogni ritorno a `live` rifarebbe il
    // tentativo — ogni rifiuto riporta il focus sul campo del nome, e chi sta
    // correggendo l'email non riuscirebbe a finire di scrivere.
    if (this.ingressoChiesto) return;
    this.ingressoChiesto = true;
    this.ctx.bus.emit('joinRequest', { videoMuted: true, audioMuted: true });
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
    // Nella piazza si guarda un po' più da vicino (circa tre quarti
    // dell'altezza del mondo): i personaggi e i loro vestiti si riconoscono,
    // e la telecamera segue il proprio. La mappa classica mostra tutto.
    const piazza = this.ctx.config.map !== 'classic';
    const DESIRED_VIEW_H = piazza ? Math.round(world.h * 0.72) : world.h;
    let zoom = vh / DESIRED_VIEW_H;
    zoom = Math.min(1.2, Math.max(0.42, zoom));
    this.cameras.main.setZoom(zoom);
  };

  private smontata = false;

  private teardown(): void {
    if (this.smontata) return;
    this.smontata = true;
    this.scale.off('resize', this.applyCameraZoom, this);
    this.luoghi?.destroy();
    this.atmosfera?.destroy();
    for (const u of this.busUnsubs) u();
    this.busUnsubs.length = 0;
    this.movement.destroy();
    this.store.stop();
    this.gate.destroy();
  }
}

function normalizzaNome(nome: string): string {
  return nome.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
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

