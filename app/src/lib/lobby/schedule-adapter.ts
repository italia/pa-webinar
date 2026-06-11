import type { EventSchedule, EventStatus, Unsub } from '@pa-webinar/lobby';

import { Listeners } from './shared';

/** App event status (waiting-room.tsx) → lobby EventStatus. */
export type AppEventStatus = 'PUBLISHED' | 'LIVE' | 'ENDED' | 'IDLE' | 'PROVISIONING';

function mapStatus(s: AppEventStatus): EventStatus {
  if (s === 'LIVE') return 'live';
  if (s === 'ENDED') return 'ended';
  return 'scheduled'; // PUBLISHED / IDLE / PROVISIONING are all "doors closed, counting down"
}

/**
 * Real EventSchedule mapping the waiting-room event status. The React wrapper
 * calls `update()` whenever the `event.status` prop changes, so the gate opens
 * on the LIVE transition with no refresh.
 */
export class EventStatusSchedule implements EventSchedule {
  private status: EventStatus;
  private readonly listeners = new Listeners<EventStatus>();

  constructor(
    initial: AppEventStatus,
    private readonly startsAtMs: number,
    private readonly host: boolean,
  ) {
    this.status = mapStatus(initial);
  }

  getStatus(): EventStatus {
    return this.status;
  }

  getStartsAt(): number {
    return this.startsAtMs;
  }

  isHost(): boolean {
    return this.host;
  }

  on(_ev: 'statusChange', cb: (s: EventStatus) => void): Unsub {
    return this.listeners.add(cb);
  }

  /** Push a new app status; emits if the mapped lobby status changed. */
  update(appStatus: AppEventStatus): void {
    const next = mapStatus(appStatus);
    if (next === this.status) return;
    this.status = next;
    this.listeners.emit(next);
  }
}
