import mitt from 'mitt';
import type { Emitter } from 'mitt';

import type { EventSchedule } from '../ports/EventSchedule';
import type { EventStatus, Unsub } from '../ports/types';

type Events = { statusChange: EventStatus };

export interface MockScheduleOptions {
  /** Seconds until the event flips to live. <= 0 starts live immediately. */
  startInSeconds?: number;
  host?: boolean;
  initialStatus?: EventStatus;
}

/**
 * Drives the event lifecycle for the harness. `startInSeconds` sets the
 * countdown (querystring `?in=` in the demo); the status auto-advances to
 * `live` when it elapses. `host` (querystring `?host=1`) opens the gate early.
 */
export class MockEventSchedule implements EventSchedule {
  private readonly emitter: Emitter<Events> = mitt<Events>();
  private readonly startsAt: number;
  private readonly host: boolean;
  private status: EventStatus;
  private timer = 0;

  constructor(opts: MockScheduleOptions = {}) {
    const startIn = opts.startInSeconds ?? 60;
    this.startsAt = Date.now() + startIn * 1000;
    this.host = opts.host ?? false;
    this.status = opts.initialStatus ?? (startIn <= 0 ? 'live' : 'scheduled');

    if (this.status === 'scheduled') {
      this.timer = window.setTimeout(
        () => this.setStatus('live'),
        Math.max(0, this.startsAt - Date.now()),
      );
    }
  }

  getStatus(): EventStatus {
    return this.status;
  }

  getStartsAt(): number {
    return this.startsAt;
  }

  isHost(): boolean {
    return this.host;
  }

  on(ev: keyof Events, cb: (s: EventStatus) => void): Unsub {
    this.emitter.on(ev, cb);
    return () => this.emitter.off(ev, cb);
  }

  /** Manually drive status (handy from the dev console). */
  setStatus(s: EventStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.emitter.emit('statusChange', s);
  }

  /** Harness cleanup — clears the pending auto-advance timer. */
  dispose(): void {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = 0;
    this.emitter.all.clear();
  }
}
