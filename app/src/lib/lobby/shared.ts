/**
 * Shared local-user state between the lobby adapters.
 *
 * The presence adapter keeps `name` current (the lobby pushes name edits through
 * presence.setProfile); the conference adapter reads it at join time, because
 * the lobby's `conference.join(sel)` carries only device selection, not the
 * name — and the real `onEnterLive(name, prefs)` needs the name.
 */
export interface LobbyLocalState {
  name: string;
  color: string;
  helmet: boolean;
  glasses: boolean;
}

/** Minimal typed event emitter (avoids pulling a dep into the app). */
export class Listeners<T> {
  private readonly set = new Set<(v: T) => void>();
  add(cb: (v: T) => void): () => void {
    this.set.add(cb);
    return () => this.set.delete(cb);
  }
  emit(v: T): void {
    for (const cb of this.set) cb(v);
  }
  clear(): void {
    this.set.clear();
  }
}
