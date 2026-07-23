import type {
  EmoteType,
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
 *  - the ping has no inCall channel: peers are always rendered as waiting (the
 *    amphitheatre shows only the local user after they join). Networking that
 *    needs a ping field (a follow-up).
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
  emote?: { type: EmoteType; at: number };
}

const PING_MS = 200;
const DEFAULT_COLOR = '#48566a';

/**
 * Per quanto tempo l'emote viene ri-allegata a ogni ping.
 *
 * Serve perché Redis tiene UN SOLO record per utente, l'ultimo: se l'emote
 * viaggiasse in un ping soltanto resterebbe leggibile ~200ms e chi poll-a con
 * un minimo di jitter di rete non la vedrebbe mai. Ripetendola per la durata
 * dell'animazione (EMOTE_MS del lobby, 1500ms) chi legge la becca di sicuro e
 * deduplica sull'`at`. Effetto collaterale utile: un'emote vista per la prima
 * volta non può essere più vecchia di questa finestra, quindi non serve
 * confrontare orologi fra client per scartare quelle stantie.
 */
const EMOTE_BROADCAST_MS = 1500;

/**
 * Distanza minima fra due emote allegate al ping. Non è cosmesi, è correttezza.
 *
 * Chi chiama è un handler di `keydown` senza guardia sull'auto-repeat: tenendo
 * premuto E il browser ripete l'evento ~30 volte al secondo. L'emote NON fa una
 * POST propria (viaggia sul tick successivo, vedi `emote()`), ma senza questo
 * throttle ogni ripetizione sovrascriverebbe `pendingEmote` con un nuovo `at`,
 * e i peer che deduplicano su `at` vedrebbero un saluto solo che non finisce
 * mai invece di uno con un inizio e una fine. La soglia sta qui e non nel gioco
 * perché è questo lo strato che possiede lo stato di trasmissione; il gioco
 * anima comunque l'avatar locale a ogni pressione.
 */
const EMOTE_MIN_INTERVAL_MS = 600;

export class GardenPresenceClient implements PresenceClient {
  private selfId = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private readonly latest = { x: 0, y: 0, facing: 'down' as Facing };

  private peers: PeerState[] = [];
  private byId = new Map<string, PeerState>();
  /** Emote locale in corso di trasmissione (vedi EMOTE_BROADCAST_MS). */
  private pendingEmote: { type: EmoteType; at: number } | null = null;
  /** Ultima emote già notificata per peer, per non riemetterla a ogni poll. */
  private readonly seenEmoteAt = new Map<string, number>();

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

  /**
   * Emote di rete vera, non più no-op.
   *
   * Era dichiarata "il protocollo ping non ha un canale emote": vero alla
   * lettera, ma il risultato era che chi premeva il tasto vedeva la PROPRIA
   * animazione ed era convinto che gli altri la vedessero — un saluto che non
   * arrivava a nessuno. Fra togliere il tasto e aggiungere un campo, il campo
   * costa meno: il ping è già il canale di presenza (posizione e profilo
   * passano di lì), e `emote` è opzionale nello schema della rotta, quindi i
   * client vecchi continuano a funzionare senza sapere che esiste.
   *
   * NIENTE POST fuori banda: l'emote viaggia sul PROSSIMO ping (5Hz), cioè
   * entro ≤200ms. Un POST immediato per ogni pressione spendeva il budget della
   * rotta ping (600/min per IP) sullo STESSO conto dei ping di posizione: due
   * utenti dietro lo stesso NAT erano già al limite, e un tasto tenuto premuto
   * li faceva sparire dal giardino di tutti. Duecento millisecondi su un saluto
   * non si notano; l'avatar sparito sì. Il gioco anima comunque il gesto locale
   * all'istante.
   */
  emote(type: EmoteType): void {
    if (!this.connected) return;
    const now = Date.now();
    if (this.pendingEmote && now - this.pendingEmote.at < EMOTE_MIN_INTERVAL_MS) return;
    this.pendingEmote = { type, at: now };
    // Nessun `this.ping()` qui: lo raccoglie il tick successivo (vedi sopra).
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
    this.pendingEmote = null;
    this.seenEmoteAt.clear();
  }

  // ── internals ──
  private wireBody(): Record<string, unknown> {
    const xPct = clampPct((this.latest.x / this.world.w) * 100);
    const yPct = clampPct((this.latest.y / this.world.h) * 100);
    const emote = this.currentEmote();
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
      ...(emote ? { emote } : {}),
    };
  }

  /** L'emote locale finché è dentro la finestra di ripetizione, poi scade. */
  private currentEmote(): { type: EmoteType; at: number } | null {
    if (!this.pendingEmote) return null;
    if (Date.now() - this.pendingEmote.at >= EMOTE_BROADCAST_MS) {
      this.pendingEmote = null;
      return null;
    }
    return this.pendingEmote;
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
      // Dopo l'eventuale join, mai prima: il PeerStore butta via le emote dei
      // peer che non ha ancora in mappa, quindi un saluto arrivato insieme al
      // primo avvistamento andrebbe perso.
      if (peer.emote && this.seenEmoteAt.get(id) !== peer.emote.at) {
        this.seenEmoteAt.set(id, peer.emote.at);
        this.onEmote.emit(peer);
      }
    }
    for (const [id, peer] of this.byId) {
      if (!next.has(id)) {
        // Se rientra ricomincia da capo: tenere lo storico impedirebbe di
        // rivedere un saluto identico, e la mappa crescerebbe per sempre.
        this.seenEmoteAt.delete(id);
        this.onLeave.emit(peer);
      }
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
      ...(w.emote ? { emote: w.emote } : {}),
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
