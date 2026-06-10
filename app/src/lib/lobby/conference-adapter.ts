import type { ConferenceState, DeviceSelection, Unsub } from '@pa-webinar/lobby';

import type { LobbyLocalState } from './shared';

export interface JoinPrefs {
  cameraOn: boolean;
  micOn: boolean;
}

/**
 * Real ConferenceState. In production the lobby is UNMOUNTED the moment the user
 * enters the call (React swaps the waiting room for the consent flow / Jitsi),
 * so this adapter never needs the Jitsi IFrame API — `join()` simply triggers
 * the existing `onEnterLive(name, prefs)` flow. Participant tracking isn't
 * exposed (Jitsi ids aren't mappable to garden ids), so getParticipants() is
 * empty and the lobby only ever seats the local user in the amphitheatre.
 */
export class EnterLiveConference implements ConferenceState {
  constructor(
    private readonly shared: LobbyLocalState,
    private readonly onEnter: (name: string, prefs: JoinPrefs) => void,
  ) {}

  getParticipants(): { id: string }[] {
    return [];
  }

  join(devices: DeviceSelection): Promise<void> {
    this.onEnter(this.shared.name, {
      cameraOn: !devices.videoMuted,
      micOn: !devices.audioMuted,
    });
    return Promise.resolve();
  }

  leave(): Promise<void> {
    return Promise.resolve();
  }

  on(_ev: 'participantJoin' | 'participantLeave', _cb: (id: string) => void): Unsub {
    return () => undefined;
  }
}
