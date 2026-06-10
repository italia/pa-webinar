import type {
  Facing,
  PeerState,
  PlayerProfile,
  PresenceClient,
  Unsub,
} from '@pa-webinar/lobby';

import { Listeners, type LobbyLocalState } from './shared';

/**
 * Real PresenceClient over the existing `/api/events/:slug/garden/ping` Redis
 * loop. It POSTs the local transform every ~200ms and reads back the full peer
 * snapshot (10s TTL, includes self → filtered out).
 *
 * Impedance matching (the ping protocol predates this lobby):
 *  - ping x/y are 0..100 PERCENT of the stage; the lobby uses world px. We map
 *    percent ↔ px over the FULL world (same convention as the existing SVG
 *    garden, which shares this Redis room — so the two interoperate and every
 *    walkable position round-trips without edge clamping).
 *  - the ping has no colour/accessories field, so we smuggle them through
 *    `avatarId` (6 hex colour + optional 'h'/'g' flags) — round-trips without a
 *    backend change. Legacy SVG-garden ids fall back to a default look.
 *  - the ping has no emote/inCall channel: emotes are local-only here and peers
 *    are always rendered as waiting (the amphitheatre shows only the local user
 *    after they join). Networking those needs ping fields (a follow-up).
 */
interface GardenPeerWire {
  userId: string;
  displayName: string;
  avatarId: string;
  x: number;
  y: number;
  facing: Facing;
  walkPhase: number;
  updatedAt: number;
}

const PING_MS = 200;
const DEFAULT_COLOR = '#48566a';

export class GardenPresenceClient implements PresenceClient {
  private selfId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private readonly latest = { x: 0, y: 0, facing: 'down' as Facing };

  private peers: PeerState[] = [];
  private byId = new Map<string, PeerState>();

  private readonly onJoin = new Listeners<PeerState>();
  private readonly onLeave = new Listeners<PeerState>();
  private readonly onMove = new Listeners<PeerState>();
  private readonly onEmote = new Listeners<PeerState>();
  private readonly onProfile = new Listeners<PeerState>();

  constructor(
    private readonly slug: string,
    private readonly world: { w: number; h: number },
    private readonly shared: LobbyLocalState,
  ) {}

  connect(profile: PlayerProfile): Promise<void> {
    this.selfId = profile.id;
    this.shared.name = profile.name.trim() || 'Ospite';
    this.shared.color = profile.color;
    this.shared.helmet = profile.accessories.helmet ?? false;
    this.shared.glasses = profile.accessories.glasses ?? false;
    this.latest.x = this.world.w / 2;
    this.latest.y = this.world.h * 0.6;
    this.connected = true;
    void this.ping(false);
    this.timer = setInterval(() => void this.ping(false), PING_MS);
    return Promise.resolve();
  }

  setProfile(p: Partial<PlayerProfile>): void {
    if (p.name !== undefined) this.shared.name = p.name.trim() || 'Ospite';
    if (p.color !== undefined) this.shared.color = p.color;
    if (p.accessories) {
      if (p.accessories.helmet !== undefined) this.shared.helmet = p.accessories.helmet;
      if (p.accessories.glasses !== undefined) this.shared.glasses = p.accessories.glasses;
    }
  }

  move(x: number, y: number, facing: Facing): void {
    this.latest.x = x;
    this.latest.y = y;
    this.latest.facing = facing;
  }

  emote(_type: 'wave' | 'heart'): void {
    /* the ping protocol has no emote channel — local-only for now */
  }

  getPeers(): PeerState[] {
    return this.peers;
  }

  on(
    ev: 'peerJoin' | 'peerLeave' | 'peerMove' | 'peerEmote' | 'peerProfile',
    cb: (peer: PeerState) => void,
  ): Unsub {
    switch (ev) {
      case 'peerJoin':
        return this.onJoin.add(cb);
      case 'peerLeave':
        return this.onLeave.add(cb);
      case 'peerMove':
        return this.onMove.add(cb);
      case 'peerEmote':
        return this.onEmote.add(cb);
      case 'peerProfile':
        return this.onProfile.add(cb);
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onJoin.clear();
    this.onLeave.clear();
    this.onMove.clear();
    this.onEmote.clear();
    this.onProfile.clear();
    try {
      const body = JSON.stringify({ ...this.wireBody(), leave: true });
      navigator.sendBeacon?.(
        `/api/events/${this.slug}/garden/ping`,
        new Blob([body], { type: 'application/json' }),
      );
    } catch {
      /* ignore */
    }
    this.peers = [];
    this.byId.clear();
  }

  // ── internals ──
  private wireBody(): Record<string, unknown> {
    const xPct = clampPct((this.latest.x / this.world.w) * 100);
    const yPct = clampPct((this.latest.y / this.world.h) * 100);
    return {
      userId: this.selfId,
      // The route stores at most 80 chars; cap here so a long registered name
      // never trips the zod max(80) and silently 400s every ping.
      displayName: this.shared.name.slice(0, 80),
      avatarId: encodeAvatar(this.shared.color, this.shared.helmet, this.shared.glasses),
      x: xPct,
      y: yPct,
      facing: this.latest.facing,
      walkPhase: 0,
    };
  }

  private async ping(leave: boolean): Promise<void> {
    if (!this.connected && !leave) return;
    try {
      const res = await fetch(`/api/events/${this.slug}/garden/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...this.wireBody(), ...(leave ? { leave: true } : {}) }),
      });
      if (!res.ok) return;
      const json = (await res.json()) as { peers?: GardenPeerWire[] };
      if (!this.connected) return;
      this.ingest(json.peers ?? []);
    } catch {
      /* next tick retries */
    }
  }

  private ingest(wire: GardenPeerWire[]): void {
    const next = new Map<string, PeerState>();
    for (const w of wire) {
      if (w.userId === this.selfId) continue;
      next.set(w.userId, this.toPeerState(w));
    }
    // Diff for lifecycle events (positions are polled, not evented).
    for (const [id, peer] of next) {
      const prev = this.byId.get(id);
      if (!prev) {
        this.onJoin.emit(peer);
      } else if (prev.name !== peer.name || appearanceChanged(prev, peer)) {
        this.onProfile.emit(peer);
      }
    }
    for (const [id, peer] of this.byId) {
      if (!next.has(id)) this.onLeave.emit(peer);
    }
    this.byId = next;
    this.peers = [...next.values()];
  }

  private toPeerState(w: GardenPeerWire): PeerState {
    const look = decodeAvatar(w.avatarId);
    return {
      id: w.userId,
      name: w.displayName,
      color: look.color,
      accessories: { helmet: look.helmet, glasses: look.glasses },
      x: (w.x / 100) * this.world.w,
      y: (w.y / 100) * this.world.h,
      facing: w.facing,
      inCall: false,
    };
  }
}

function appearanceChanged(a: PeerState, b: PeerState): boolean {
  return (
    a.color !== b.color ||
    !!a.accessories.helmet !== !!b.accessories.helmet ||
    !!a.accessories.glasses !== !!b.accessories.glasses
  );
}

function clampPct(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

function encodeAvatar(color: string, helmet: boolean, glasses: boolean): string {
  return `${color.replace('#', '').slice(0, 6)}${helmet ? 'h' : ''}${glasses ? 'g' : ''}`;
}

function decodeAvatar(avatarId: string): { color: string; helmet: boolean; glasses: boolean } {
  const m = /^([0-9a-f]{6})([hg]*)$/i.exec(avatarId);
  if (!m) return { color: DEFAULT_COLOR, helmet: false, glasses: false };
  const flags = m[2] ?? '';
  return {
    color: `#${m[1]}`,
    helmet: flags.includes('h'),
    glasses: flags.includes('g'),
  };
}
