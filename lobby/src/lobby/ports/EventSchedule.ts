import type { EventStatus, Unsub } from './types';

export type { EventStatus };

/**
 * The event lifecycle + the local user's role. Drives the gate: `scheduled`
 * keeps it locked with a countdown, `live` opens it, `ended` closes the room.
 * Hosts may enter before `live`. The future real implementation maps the
 * waiting-room.tsx status (PUBLISHED→scheduled, LIVE→live, ENDED→ended); the
 * dev harness uses MockEventSchedule (querystring driven).
 */
export interface EventSchedule {
  getStatus(): EventStatus;
  /** Event start, epoch ms — the countdown target. */
  getStartsAt(): number;
  /** Hosts can enter during `scheduled`; the gate opens for them early. */
  isHost(): boolean;
  on(ev: 'statusChange', cb: (s: EventStatus) => void): Unsub;
}
