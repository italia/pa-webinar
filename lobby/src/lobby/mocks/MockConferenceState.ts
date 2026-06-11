import mitt from 'mitt';
import type { Emitter } from 'mitt';

import type { ConferenceState } from '../ports/ConferenceState';
import type { DeviceSelection, Unsub } from '../ports/types';

type Events = { participantJoin: string; participantLeave: string };

/**
 * Stand-in for the Jitsi conference. Starts with a couple of "speakers" already
 * in the call; `join()` simulates the network round-trip and adds the local
 * user. (The speakers have no presence row, so they don't render as garden
 * avatars — they represent the actual video speakers. The local avatar's inCall
 * is driven by the scene, not by this event, which is the realistic split.)
 */
export class MockConferenceState implements ConferenceState {
  private readonly emitter: Emitter<Events> = mitt<Events>();
  private readonly participants = new Set<string>(['speaker-anchor', 'speaker-guest']);
  private readonly joinDelayMs: number;

  constructor(opts: { joinDelayMs?: number } = {}) {
    this.joinDelayMs = opts.joinDelayMs ?? 220;
  }

  getParticipants(): { id: string }[] {
    return [...this.participants].map((id) => ({ id }));
  }

  join(_devices: DeviceSelection): Promise<void> {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.participants.add('local-self');
        this.emitter.emit('participantJoin', 'local-self');
        resolve();
      }, this.joinDelayMs);
    });
  }

  leave(): Promise<void> {
    if (this.participants.delete('local-self')) {
      this.emitter.emit('participantLeave', 'local-self');
    }
    return Promise.resolve();
  }

  on(ev: keyof Events, cb: (id: string) => void): Unsub {
    this.emitter.on(ev, cb);
    return () => this.emitter.off(ev, cb);
  }
}
