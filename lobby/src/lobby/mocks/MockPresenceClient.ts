import mitt from 'mitt';
import type { Emitter } from 'mitt';

import type { PresenceClient } from '../ports/PresenceClient';
import type { EmoteType, Facing, PeerState, PlayerProfile, Unsub } from '../ports/types';
import { AVATAR_COLORS } from '../systems/AvatarTextureFactory';

/**
 * Simulated garden of ~80 wandering peers — the test bed for density, culling
 * and interpolation. Bots random-walk with pauses, emote occasionally, and a
 * few drift into the call over time to populate the amphitheatre. Positions are
 * mutated in place and returned live from getPeers() (no per-frame allocation),
 * exactly how the scene polls them.
 *
 * The world bounds are a MOCK-ONLY constructor arg (the real client gets coords
 * from the server); everything else satisfies the PresenceClient port verbatim.
 */
interface Bot extends PeerState {
  tx: number;
  ty: number;
  speed: number;
  pauseUntil: number;
}

type Events = {
  peerJoin: PeerState;
  peerLeave: PeerState;
  peerMove: PeerState;
  peerEmote: PeerState;
  peerProfile: PeerState;
};

const NAMES = [
  'Giulia', 'Marco', 'Sofia', 'Luca', 'Aurora', 'Matteo', 'Chiara', 'Davide',
  'Sara', 'Andrea', 'Elena', 'Francesco', 'Martina', 'Alessandro', 'Giorgia',
  'Lorenzo', 'Beatrice', 'Riccardo', 'Anna', 'Tommaso', 'Federica', 'Simone',
  'Valentina', 'Pietro', 'Ludovica', 'Gabriele', 'Noemi', 'Edoardo', 'Greta', 'Filippo',
];

export interface MockPresenceOptions {
  world?: { w: number; h: number };
  /** How many bots start already in the call. */
  initialInCall?: number;
}

export class MockPresenceClient implements PresenceClient {
  private readonly emitter: Emitter<Events> = mitt<Events>();
  private readonly bots = new Map<string, Bot>();
  private list: Bot[] = [];
  private readonly world: { w: number; h: number };
  private selfId = '';
  private connected = false;
  private seq = 0;
  private tickTimer = 0;
  private slowTimer = 0;

  private readonly gardenY0: number;
  private readonly gardenY1: number;

  constructor(nBots = 80, opts: MockPresenceOptions = {}) {
    this.world = opts.world ?? { w: 1600, h: 1024 };
    this.gardenY0 = this.world.h * 0.42;
    this.gardenY1 = this.world.h * 0.95;
    const startInCall = opts.initialInCall ?? 6;
    for (let i = 0; i < nBots; i++) this.bots.set(...this.makeBot(i < startInCall));
    this.rebuildList();
  }

  connect(profile: PlayerProfile): Promise<void> {
    this.selfId = profile.id;
    this.connected = true;
    this.tickTimer = window.setInterval(() => this.tick(), 100);
    this.slowTimer = window.setInterval(() => this.slowTick(), 1000);
    return Promise.resolve();
  }

  setProfile(_p: Partial<PlayerProfile>): void {
    /* self is not a bot; nothing to simulate for other peers */
  }

  move(_x: number, _y: number, _facing: Facing): void {
    /* self transform isn't reflected to bots in the mock */
  }

  emote(_type: EmoteType): void {
    /* self emote is rendered locally by the scene */
  }

  getPeers(): PeerState[] {
    return this.list;
  }

  on(ev: keyof Events, cb: (peer: PeerState) => void): Unsub {
    this.emitter.on(ev, cb);
    return () => this.emitter.off(ev, cb);
  }

  disconnect(): void {
    this.connected = false;
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    if (this.slowTimer) window.clearInterval(this.slowTimer);
    this.tickTimer = 0;
    this.slowTimer = 0;
    this.emitter.all.clear();
    this.bots.clear();
    this.list = [];
  }

  /** Stress hook: add more bots (up to a couple hundred). */
  addBots(n: number): void {
    for (let i = 0; i < n; i++) {
      const [id, bot] = this.makeBot(false);
      this.bots.set(id, bot);
      this.emitter.emit('peerJoin', bot);
    }
    this.rebuildList();
  }

  // ── simulation ──
  private tick(): void {
    if (!this.connected) return;
    const now = performance.now();
    for (const bot of this.bots.values()) {
      if (bot.inCall) continue; // seated on stage; the scene owns its position
      if (now < bot.pauseUntil) continue;
      const dx = bot.tx - bot.x;
      const dy = bot.ty - bot.y;
      const dist = Math.hypot(dx, dy);
      const step = bot.speed * 0.1;
      if (dist < step) {
        bot.x = bot.tx;
        bot.y = bot.ty;
        this.pickTarget(bot);
        if (Math.random() < 0.5) bot.pauseUntil = now + 600 + Math.random() * 2200;
      } else {
        bot.x += (dx / dist) * step;
        bot.y += (dy / dist) * step;
        bot.facing =
          Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
      this.emitter.emit('peerMove', bot);
    }
  }

  private slowTick(): void {
    if (!this.connected) return;
    const now = performance.now();
    // Occasional emotes.
    const arr = this.list;
    if (arr.length > 0) {
      const b = arr[Math.floor(Math.random() * arr.length)];
      if (b && !b.inCall && Math.random() < 0.7) {
        const type: EmoteType = Math.random() < 0.5 ? 'wave' : 'heart';
        b.emote = { type, at: now };
        this.emitter.emit('peerEmote', b);
      }
    }
    // Gradually move a waiting bot into the call (populate the amphitheatre).
    if (Math.random() < 0.25) {
      const waiting = arr.find((b) => !b.inCall);
      if (waiting) {
        waiting.inCall = true;
        this.emitter.emit('peerProfile', waiting);
      }
    }
  }

  private makeBot(inCall: boolean): [string, Bot] {
    const id = `bot_${this.seq++}`;
    const x = 60 + Math.random() * (this.world.w - 120);
    const y = this.gardenY0 + Math.random() * (this.gardenY1 - this.gardenY0);
    const bot: Bot = {
      id,
      name: pick(NAMES),
      color: pick(AVATAR_COLORS as readonly string[]),
      accessories: {
        helmet: Math.random() < 0.18,
        glasses: Math.random() < 0.3,
      },
      x,
      y,
      facing: 'down',
      inCall,
      tx: x,
      ty: y,
      speed: 36 + Math.random() * 40,
      pauseUntil: 0,
    };
    this.pickTarget(bot);
    return [id, bot];
  }

  private pickTarget(bot: Bot): void {
    bot.tx = 60 + Math.random() * (this.world.w - 120);
    bot.ty = this.gardenY0 + Math.random() * (this.gardenY1 - this.gardenY0);
  }

  private rebuildList(): void {
    this.list = [...this.bots.values()].filter((b) => b.id !== this.selfId);
  }
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}
