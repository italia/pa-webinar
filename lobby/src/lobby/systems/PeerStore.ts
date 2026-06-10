import type { ConferenceState } from '../ports/ConferenceState';
import type { PresenceClient } from '../ports/PresenceClient';
import type { EmoteType, Facing, PeerState, Unsub } from '../ports/types';

/**
 * The single place the two sources of truth converge.
 *
 *  - {@link PresenceClient} owns identity + position (x, y, facing, profile).
 *  - {@link ConferenceState} owns call membership (who is actually in Jitsi).
 *
 * `inCall` is reconciled here as "presence says inCall OR the conference lists
 * this id". Everything downstream (the scene) reads one merged map and never
 * has to think about which port a fact came from.
 *
 * Lifecycle facts (join/leave/profile/inCall/emote) are pushed as events so the
 * scene can create/destroy sprites and react; high-frequency position updates
 * are NOT evented — the scene polls `values()` each frame for interpolation,
 * which avoids 80×10Hz of event churn.
 */
export interface MergedPeer extends PeerState {
  /** Reconciled call membership (overrides the raw presence `inCall`). */
  inCall: boolean;
}

export type PeerStoreEvent =
  | { type: 'add'; peer: MergedPeer }
  | { type: 'remove'; id: string }
  | { type: 'profile'; peer: MergedPeer }
  | { type: 'inCall'; peer: MergedPeer }
  | { type: 'emote'; id: string; emote: EmoteType };

export class PeerStore {
  private readonly peers = new Map<string, MergedPeer>();
  /** Ids the conference reports as in-call (authoritative call membership). */
  private readonly confIds = new Set<string>();
  private readonly unsubs: Unsub[] = [];

  constructor(
    private readonly presence: PresenceClient,
    private readonly conference: ConferenceState,
    private readonly onEvent: (e: PeerStoreEvent) => void,
  ) {}

  start(): void {
    for (const c of this.conference.getParticipants()) this.confIds.add(c.id);
    for (const p of this.presence.getPeers()) this.ingest(p, /*emitAdd*/ false);

    this.unsubs.push(
      this.presence.on('peerJoin', (p) => this.ingest(p, true)),
      this.presence.on('peerProfile', (p) => this.onProfile(p)),
      this.presence.on('peerEmote', (p) => this.onEmote(p)),
      this.presence.on('peerLeave', (p) => this.remove(p.id)),
      // peerMove is intentionally NOT subscribed — positions are polled.
      this.conference.on('participantJoin', (id) => this.onConfChange(id, true)),
      this.conference.on('participantLeave', (id) => this.onConfChange(id, false)),
    );
  }

  values(): IterableIterator<MergedPeer> {
    return this.peers.values();
  }

  get(id: string): MergedPeer | undefined {
    return this.peers.get(id);
  }

  /**
   * Poll the latest transform for every peer from presence (called per frame),
   * and reconcile `inCall` transitions that flow through presence (e.g. a bot
   * "entering" the call in the simulation). Mutates merged peers in place; the
   * rare inCall change is evented so the scene can re-seat the avatar.
   */
  syncPositions(): void {
    for (const p of this.presence.getPeers()) {
      const m = this.peers.get(p.id);
      if (!m) {
        this.ingest(p, true);
        continue;
      }
      m.x = p.x;
      m.y = p.y;
      m.facing = p.facing;
      const reconciled = p.inCall || this.confIds.has(p.id);
      if (reconciled !== m.inCall) {
        m.inCall = reconciled;
        this.onEvent({ type: 'inCall', peer: m });
      }
    }
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.peers.clear();
    this.confIds.clear();
  }

  private reconcileInCall(p: { id: string; inCall: boolean }): boolean {
    return p.inCall || this.confIds.has(p.id);
  }

  private ingest(p: PeerState, emitAdd: boolean): void {
    const merged: MergedPeer = { ...p, inCall: this.reconcileInCall(p) };
    this.peers.set(p.id, merged);
    if (emitAdd) this.onEvent({ type: 'add', peer: merged });
  }

  private remove(id: string): void {
    if (!this.peers.delete(id)) return;
    this.confIds.delete(id);
    this.onEvent({ type: 'remove', id });
  }

  private onProfile(p: PeerState): void {
    const m = this.peers.get(p.id);
    if (!m) {
      this.ingest(p, true);
      return;
    }
    m.name = p.name;
    m.color = p.color;
    m.accessories = p.accessories;
    this.onEvent({ type: 'profile', peer: m });
  }

  private onEmote(p: PeerState): void {
    const m = this.peers.get(p.id);
    if (!m || !p.emote) return;
    m.emote = p.emote;
    this.onEvent({ type: 'emote', id: p.id, emote: p.emote.type });
  }

  private onConfChange(id: string, inCall: boolean): void {
    if (inCall) this.confIds.add(id);
    else this.confIds.delete(id);
    const m = this.peers.get(id);
    if (!m) return; // a participant with no presence row yet; reconciles on ingest
    // inCall = conference says so OR presence says so.
    const finalInCall = this.confIds.has(id) || this.presenceSaysInCall(id);
    if (finalInCall !== m.inCall) {
      m.inCall = finalInCall;
      this.onEvent({ type: 'inCall', peer: m });
    }
  }

  private presenceSaysInCall(id: string): boolean {
    return this.presence.getPeers().find((p) => p.id === id)?.inCall ?? false;
  }
}

export type { Facing };
